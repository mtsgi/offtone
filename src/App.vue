<script setup vapor lang="ts">
import UApp from "@nuxt/ui/components/App.vue";
import { onMounted, onScopeDispose, ref } from "vue";
import FolderHeader from "./components/FolderHeader.vue";
import MusicLibrary from "./components/MusicLibrary.vue";
import PlaybackBar from "./components/PlaybackBar.vue";
import NowPlaying from "./components/NowPlaying.vue";
import { createNowPlayingHistory } from "./lib/now-playing-history";
import DiagnosticsPanel from "./components/DiagnosticsPanel.vue";
import UpdateNotice from "./components/UpdateNotice.vue";
import { useLibraryStore } from "./stores/library";

const library = useLibraryStore();
const nowPlayingOpen = ref(false);
const nowPlayingHistory = createNowPlayingHistory(window, (open) => {
  nowPlayingOpen.value = open;
});
onScopeDispose(() => nowPlayingHistory.dispose());

onMounted(() => {
  void library.restore();
});
</script>

<template>
  <UApp>
    <div class="flex min-h-dvh flex-col">
      <FolderHeader />
      <UpdateNotice />
      <MusicLibrary />
      <DiagnosticsPanel />
      <PlaybackBar @open="nowPlayingHistory.open" />
      <NowPlaying :open="nowPlayingOpen" @close="nowPlayingHistory.close" />
    </div>
  </UApp>
</template>
