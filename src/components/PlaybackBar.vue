<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { usePlayerStore } from "../stores/player";
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
    <div class="mini-player-progress" aria-hidden="true">
      <span :style="{ width: `${progress}%` }" />
    </div>
    <div class="mini-player-inner">
      <button
        type="button"
        class="mini-player-track"
        aria-label="再生中の画面を開く"
        @click="emit('open')"
      >
        <span class="artwork mini-artwork" aria-hidden="true">
          <UIcon name="i-lucide-music-2" class="text-muted" />
          <ArtworkImage :src="current?.artworkUrl" />
        </span>
        <span class="min-w-0 text-left">
          <span class="block truncate text-sm font-semibold">{{
            current
              ? current.metadata?.title || current.name.replace(/\.[^.]+$/, "")
              : "曲が選択されていません"
          }}</span>
          <span v-if="current?.metadata?.artist" class="block truncate text-xs text-muted">{{
            current.metadata.artist
          }}</span>
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
