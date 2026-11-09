<script setup vapor lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
import UBadge from "@nuxt/ui/components/Badge.vue";
import UIcon from "@nuxt/ui/components/Icon.vue";
import { storeToRefs } from "pinia";
import type { Track } from "../lib/library";
import { trackArtist, trackTitle } from "../lib/music-catalog";
import { usePlayerStore } from "../stores/player";
import ArtworkImage from "./ArtworkImage.vue";

defineProps<{ tracks: Track[] }>();
const player = usePlayerStore();
const { current, playing } = storeToRefs(player);
function play(track: Track) {
  // Resolve against the current library, never the position in this filtered list.
  const index = player.tracks.findIndex((item) => item.path === track.path);
  if (index !== -1) void player.playAt(index);
}
</script>

<template>
  <ul aria-label="曲一覧" class="divide-y divide-default">
    <li v-for="track in tracks" :key="track.path">
      <UButton
        block
        color="neutral"
        :variant="current?.path === track.path ? 'soft' : 'ghost'"
        class="min-h-16 justify-start rounded-none text-left"
        :aria-current="current?.path === track.path ? 'true' : undefined"
        @click="play(track)"
      >
        <span
          class="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-elevated"
          aria-hidden="true"
        >
          <UIcon name="i-lucide-music-2" class="text-muted" /><ArtworkImage
            :src="track.artworkUrl"
          />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ trackTitle(track) }}</span>
          <span class="block truncate text-xs text-muted">{{
            [
              trackArtist(track),
              track.metadata?.album,
              !track.metadata?.artist && !track.metadata?.album ? track.path : undefined,
            ]
              .filter(Boolean)
              .join(" · ")
          }}</span>
        </span>
        <UBadge v-if="current?.path === track.path" color="neutral" variant="subtle">{{
          playing ? "再生中" : "選択中"
        }}</UBadge>
      </UButton>
    </li>
  </ul>
</template>
