import { computed, readonly, ref } from "vue";
import { defineStore } from "pinia";
import type { AlbumGrouping } from "../lib/music-catalog";
import { DEFAULT_SETTINGS, isAlbumGrouping, parseSettings } from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/storage";

export const useSettingsStore = defineStore("settings", () => {
  const preferences = ref({ ...DEFAULT_SETTINGS });
  const ready = ref(false);
  const saving = ref(false);
  const saveFailed = ref(false);
  const status = ref("");
  const albumGrouping = computed(() => preferences.value.albumGrouping);
  let restoreRequest: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  let revision = 0;

  function restore(): Promise<void> {
    restoreRequest ??= (async () => {
      const started = revision;
      try {
        const saved = parseSettings(await loadSettings());
        if (revision === started) preferences.value = saved;
      } catch {
        if (revision === started)
          status.value = "設定を読み込めませんでした。タグ優先を使用します。";
      } finally {
        ready.value = true;
      }
    })();
    return restoreRequest;
  }

  async function setAlbumGrouping(grouping: AlbumGrouping): Promise<void> {
    if (!isAlbumGrouping(grouping)) return;
    const changed = ++revision;
    preferences.value = { ...preferences.value, albumGrouping: grouping };
    const snapshot = { ...preferences.value };
    saving.value = true;
    status.value = "";
    saveFailed.value = false;
    // Serialize snapshots so a slower, older write cannot win. A failed save keeps
    // the live selection and offers retry without touching playback or file data.
    writes = writes
      .catch(() => {})
      .then(async () => {
        try {
          await saveSettings(snapshot);
          if (revision === changed) status.value = "設定を保存しました。";
        } catch {
          if (revision === changed) {
            saveFailed.value = true;
            status.value =
              "設定を保存できませんでした。現在の選択は今回のみ有効です。再試行してください。";
          }
        } finally {
          if (revision === changed) saving.value = false;
        }
      });
    await writes;
  }

  return {
    preferences: readonly(preferences),
    albumGrouping,
    ready: readonly(ready),
    saving: readonly(saving),
    saveFailed: readonly(saveFailed),
    status: readonly(status),
    restore,
    setAlbumGrouping,
  };
});
