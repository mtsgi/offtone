<script setup vapor lang="ts">
import UContainer from "@nuxt/ui/components/Container.vue";
import { storeToRefs } from "pinia";
import { usePlayerStore } from "../stores/player";

const player = usePlayerStore();
const { tracks, index, playing, current } = storeToRefs(player);
</script>

<template>
  <footer
    class="sticky bottom-0 border-t border-default bg-default pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3"
    aria-label="再生コントロール"
  >
    <UContainer class="flex max-w-3xl flex-wrap items-center justify-between gap-3">
      <div class="min-w-0 flex-1" aria-live="polite">
        <p class="text-xs text-muted">再生中の曲</p>
        <p class="truncate text-sm font-medium">
          {{ current ? current.name.replace(/\.[^.]+$/, "") : "曲が選択されていません" }}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-skip-back"
          aria-label="前の曲"
          title="前の曲"
          :disabled="index <= 0"
          @click="player.previous"
        />
        <UButton
          size="lg"
          :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
          :aria-label="playing ? '一時停止' : '再生'"
          :title="playing ? '一時停止' : '再生'"
          :disabled="!tracks.length"
          @click="player.toggle"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-lucide-skip-forward"
          aria-label="次の曲"
          title="次の曲"
          :disabled="index < 0 || index >= tracks.length - 1"
          @click="player.next"
        />
      </div>
    </UContainer>
  </footer>
</template>
