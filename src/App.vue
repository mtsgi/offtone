<script setup vapor lang="ts">
import UApp from "@nuxt/ui/components/App.vue";
import { nextTick, onMounted, onScopeDispose, ref, watchEffect } from "vue";
import FolderHeader from "./components/FolderHeader.vue";
import MusicLibrary from "./components/MusicLibrary.vue";
import PlaybackBar from "./components/PlaybackBar.vue";
import NowPlaying from "./components/NowPlaying.vue";
import SettingsView from "./components/SettingsView.vue";
import { applyTheme } from "./lib/theme";
import { createViewHistory } from "./lib/view-history";
import { useSettingsStore } from "./stores/settings";
import DiagnosticsPanel from "./components/DiagnosticsPanel.vue";
import UpdateNotice from "./components/UpdateNotice.vue";
import { useLibraryStore } from "./stores/library";

const library = useLibraryStore();
const settings = useSettingsStore();
const settingsOpen = ref(false);
const nowPlayingOpen = ref(false);
const viewHistory = createViewHistory(window, (view) => {
  const leavingSettings = settingsOpen.value && !view.settings;
  settingsOpen.value = view.settings;
  nowPlayingOpen.value = view.nowPlaying;
  if (leavingSettings) void nextTick(() => document.getElementById("settings-button")?.focus());
});
onScopeDispose(() => viewHistory.dispose());

const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
watchEffect((onCleanup) => {
  const theme = settings.theme;
  const update = () => applyTheme(theme, systemTheme?.matches ?? false);
  update();
  if (theme === "system" && systemTheme) {
    systemTheme.addEventListener("change", update);
    onCleanup(() => systemTheme.removeEventListener("change", update));
  }
});

onMounted(() => {
  void settings.restore();
  void library.restore();
});
</script>

<template>
  <UApp>
    <div class="flex min-h-dvh flex-col">
      <FolderHeader :settings-open="settingsOpen" @settings="viewHistory.openSettings" />
      <UpdateNotice />
      <MusicLibrary v-show="!settingsOpen" />
      <SettingsView v-if="settingsOpen" @back="viewHistory.closeSettings" />
      <DiagnosticsPanel v-show="!settingsOpen" />
      <PlaybackBar @open="viewHistory.openNowPlaying" />
      <NowPlaying :open="nowPlayingOpen" @close="viewHistory.closeNowPlaying" />
    </div>
  </UApp>
</template>
