<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { onMounted, onScopeDispose, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { usePlayerStore } from "../stores/player";
import type { RepeatMode } from "../lib/player";
import ArtworkImage from "./ArtworkImage.vue";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const player = usePlayerStore();
const {
  queue,
  order,
  currentId,
  playing,
  current,
  shuffle,
  repeat,
  currentTime,
  duration,
  volume,
  error,
} = storeToRefs(player);
const dialog = ref<HTMLDialogElement>();
const closeButton = ref<HTMLButtonElement>();
const modes: RepeatMode[] = ["off", "all", "one"];
const repeatLabels: Record<RepeatMode, string> = { off: "オフ", all: "全曲", one: "1曲" };
function cycleRepeat() {
  player.setRepeat(modes[(modes.indexOf(repeat.value) + 1) % modes.length]!);
}
function formatTime(time: number | null) {
  if (time === null || !Number.isFinite(time)) return "--:--";
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function inputValue(event: Event) {
  return Number((event.target as HTMLInputElement).value);
}
let previousFocus: HTMLElement | null = null;
let previousOverflow = "";
function show() {
  if (!dialog.value || dialog.value.open) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.value.showModal();
  closeButton.value?.focus();
}
function hide() {
  if (!dialog.value?.open) return;
  dialog.value.close();
  document.body.style.overflow = previousOverflow;
  previousFocus?.focus();
}
onMounted(() => {
  if (props.open) show();
});
// Use a watcher rather than remounting the application or the playback store.
watch(
  () => props.open,
  (open) => {
    if (open) show();
    else hide();
  },
  { flush: "post" },
);
onScopeDispose(hide);
</script>

<template>
  <dialog
    ref="dialog"
    class="now-playing"
    aria-labelledby="now-playing-label"
    aria-modal="true"
    @cancel.prevent="emit('close')"
  >
    <div class="now-playing-content">
      <header class="now-playing-header">
        <button
          ref="closeButton"
          type="button"
          class="icon-button"
          aria-label="再生中の画面を閉じる"
          @click="emit('close')"
        >
          <UIcon name="i-lucide-chevron-down" />
        </button>
        <h2 id="now-playing-label" class="text-sm font-semibold">再生中</h2>
        <span class="header-spacer" aria-hidden="true" />
      </header>
      <div class="now-playing-art-wrap">
        <div class="artwork now-playing-art" aria-hidden="true">
          <UIcon name="i-lucide-music-2" class="art-placeholder text-muted" />
          <ArtworkImage :src="current?.artworkUrl" />
        </div>
      </div>
      <div class="now-playing-info">
        <p class="truncate text-xl font-semibold" aria-live="polite">
          {{
            current
              ? current.metadata?.title || current.name.replace(/\.[^.]+$/, "")
              : "曲が選択されていません"
          }}
        </p>
        <p v-if="current?.metadata?.artist" class="truncate text-sm text-muted">
          {{ current.metadata.artist }}
        </p>
        <p v-if="current?.metadata?.album" class="truncate text-sm text-muted">
          {{ current.metadata.album }}
        </p>
        <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      </div>
      <div class="now-playing-controls">
        <input
          type="range"
          class="w-full"
          aria-label="再生位置"
          :aria-valuetext="`${formatTime(currentTime)} / ${formatTime(duration)}`"
          min="0"
          :max="duration ?? 0"
          step="0.1"
          :value="currentTime"
          :disabled="duration === null"
          @input="player.seek(inputValue($event))"
        />
        <div class="flex justify-between text-xs tabular-nums text-muted" aria-hidden="true">
          <span>{{ formatTime(currentTime) }}</span
          ><span>{{ formatTime(duration) }}</span>
        </div>
        <div class="transport-controls">
          <UButton
            color="neutral"
            :variant="shuffle ? 'soft' : 'ghost'"
            size="lg"
            icon="i-lucide-shuffle"
            aria-label="シャッフル"
            :aria-pressed="shuffle"
            @click="player.setShuffle(!shuffle)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="lg"
            icon="i-lucide-skip-back"
            aria-label="前の曲"
            :disabled="currentId === null || order.indexOf(currentId) <= 0"
            @click="player.previous"
          />
          <UButton
            class="play-primary"
            size="xl"
            :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
            :aria-label="playing ? '一時停止' : '再生'"
            :disabled="!queue.length"
            @click="player.toggle"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="lg"
            icon="i-lucide-skip-forward"
            aria-label="次の曲"
            :disabled="
              currentId === null ||
              (repeat !== 'all' && order.indexOf(currentId) >= order.length - 1)
            "
            @click="player.next"
          />
          <UButton
            color="neutral"
            :variant="repeat === 'off' ? 'ghost' : 'soft'"
            size="lg"
            :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
            :aria-label="`リピート: ${repeatLabels[repeat]}`"
            @click="cycleRepeat"
          />
        </div>
        <details class="now-playing-details">
          <summary>音量と再生キュー ({{ queue.length }})</summary>
          <label class="flex items-center gap-3 py-3 text-sm"
            ><span>音量</span
            ><input
              type="range"
              class="min-w-0 flex-1"
              aria-label="音量"
              min="0"
              max="1"
              step="0.01"
              :value="volume"
              @input="player.setVolume(inputValue($event))"
          /></label>
          <ol class="queue-list">
            <li
              v-for="(entry, queueIndex) in queue"
              :key="entry.id"
              class="flex items-center gap-1"
            >
              <UButton
                class="min-w-0 flex-1 justify-start"
                color="neutral"
                :variant="entry.id === currentId ? 'soft' : 'ghost'"
                @click="player.playId(entry.id)"
                ><span class="truncate">{{ entry.track.path }}</span></UButton
              >
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-up"
                :aria-label="`${entry.track.path} を上へ`"
                :disabled="queueIndex === 0"
                @click="player.moveQueue(queueIndex, queueIndex - 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-arrow-down"
                :aria-label="`${entry.track.path} を下へ`"
                :disabled="queueIndex === queue.length - 1"
                @click="player.moveQueue(queueIndex, queueIndex + 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="`${entry.track.path} を削除`"
                @click="player.removeFromQueue(entry.id)"
              />
            </li>
          </ol>
        </details>
      </div>
    </div>
  </dialog>
</template>
