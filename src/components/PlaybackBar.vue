<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { usePlayerStore } from "../stores/player";
import { formatTime } from "../lib/format-time";
import ArtworkImage from "./ArtworkImage.vue";

const emit = defineEmits<{ open: [] }>();
const player = usePlayerStore();
const { current, currentTime, duration, playing, queue } = storeToRefs(player);
const progress = computed(() =>
  duration.value ? Math.min(100, (currentTime.value / duration.value) * 100) : 0,
);
</script>

<template>
  <footer class="mini-player" aria-label="再生コントロール">
    <div
      class="mini-player-progress"
      role="progressbar"
      aria-label="再生位置"
      :aria-valuemin="0"
      :aria-valuemax="duration ?? 1"
      :aria-valuenow="duration === null ? undefined : Math.min(currentTime, duration)"
      :aria-valuetext="
        duration === null
          ? '再生時間は不明です'
          : `${formatTime(currentTime)} / ${formatTime(duration)}`
      "
    >
      <span :style="{ width: `${progress}%` }" />
    </div>
    <div class="mini-player-inner">
      <button
        type="button"
        class="mini-player-track"
        aria-label="再生中の画面を開く"
        :aria-describedby="
          current?.metadata?.artist ? 'mini-player-title mini-player-artist' : 'mini-player-title'
        "
        @click="emit('open')"
      >
        <span class="artwork mini-artwork" aria-hidden="true">
          <UIcon name="i-lucide-music-2" class="text-muted" />
          <ArtworkImage :src="current?.artworkUrl" />
        </span>
        <span class="min-w-0 text-left">
          <span
            id="mini-player-title"
            class="block truncate text-sm font-semibold"
            aria-live="polite"
            aria-atomic="true"
            >{{
              current
                ? current.metadata?.title || current.name.replace(/\.[^.]+$/, "")
                : "曲が選択されていません"
            }}</span
          >
          <span
            v-if="current?.metadata?.artist"
            id="mini-player-artist"
            class="block truncate text-xs text-muted"
            >{{ current.metadata.artist }}</span
          >
        </span>
      </button>
      <UButton
        size="lg"
        color="neutral"
        variant="ghost"
        :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
        :aria-label="playing ? '一時停止' : '再生'"
        :disabled="!queue.length"
        @click="player.toggle"
      />
    </div>
  </footer>
</template>
