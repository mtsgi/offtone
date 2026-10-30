<script setup vapor lang="ts">
import UApp from "@nuxt/ui/components/App.vue";
import { onMounted } from "vue";
import FolderHeader from "./components/FolderHeader.vue";
import MusicLibrary from "./components/MusicLibrary.vue";
import PlaybackBar from "./components/PlaybackBar.vue";
import UpdateNotice from "./components/UpdateNotice.vue";
import { useLibraryStore } from "./stores/library";

const library = useLibraryStore();

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
      <PlaybackBar />
    </div>
  </UApp>
</template>
