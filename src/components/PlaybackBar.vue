<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { usePlayerStore } from "../stores/player";
import type { RepeatMode } from "../lib/player";

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
} = storeToRefs(player);
const modes: RepeatMode[] = ["off", "all", "one"];
function cycleRepeat() {
  player.setRepeat(modes[(modes.indexOf(repeat.value) + 1) % modes.length]!);
}
function formatTime(time: number | null) {
  if (time === null || !Number.isFinite(time)) return "--:--";
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function inputValue(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}
</script>

<template>
  <footer
    class="sticky bottom-0 border-t border-default bg-default pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
    aria-label="再生コントロール"
  >
    <UContainer class="max-w-3xl space-y-2">
      <p class="truncate text-sm font-medium" aria-live="polite">
        {{ current ? current.name.replace(/\.[^.]+$/, "") : "曲が選択されていません" }}
      </p>
      <div class="flex items-center gap-2 text-xs tabular-nums text-muted">
        <span>{{ formatTime(currentTime) }}</span>
        <input
          type="range"
          class="min-w-0 flex-1"
          aria-label="再生位置"
          :min="0"
          :max="duration ?? 0"
          step="0.1"
          :value="currentTime"
          :disabled="duration === null"
          @input="player.seek(inputValue($event))"
        />
        <span>{{ formatTime(duration) }}</span>
      </div>
      <div class="flex flex-wrap items-center justify-center gap-1 sm:gap-2">
        <UButton
          color="neutral"
          :variant="shuffle ? 'soft' : 'ghost'"
          size="lg"
          icon="i-lucide-shuffle"
          aria-label="シャッフル"
          :aria-pressed="shuffle"
          title="シャッフル"
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
          size="lg"
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
            currentId === null || (repeat !== 'all' && order.indexOf(currentId) >= order.length - 1)
          "
          @click="player.next"
        />
        <UButton
          color="neutral"
          :variant="repeat === 'off' ? 'ghost' : 'soft'"
          size="lg"
          :icon="repeat === 'one' ? 'i-lucide-repeat-1' : 'i-lucide-repeat'"
          :aria-label="`リピート: ${repeat}`"
          :title="`リピート: ${repeat}`"
          @click="cycleRepeat"
        />
        <label class="flex items-center gap-2 px-2 text-xs"
          ><span>音量</span
          ><input
            type="range"
            class="w-20"
            aria-label="音量"
            min="0"
            max="1"
            step="0.01"
            :value="volume"
            @input="player.setVolume(inputValue($event))"
        /></label>
      </div>
      <details class="text-sm">
        <summary class="cursor-pointer py-2">再生キュー ({{ queue.length }})</summary>
        <ol class="max-h-48 overflow-y-auto">
          <li v-for="(entry, queueIndex) in queue" :key="entry.id" class="flex items-center gap-1">
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
    </UContainer>
  </footer>
</template>
