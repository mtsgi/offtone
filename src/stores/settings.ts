import { computed, readonly, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import {
  DEFAULT_SETTINGS,
  isAlbumGrouping,
  isSortDirection,
  isSortKey,
  isSortView,
  isTheme,
  parseSettings,
  type AppSettings,
} from "../lib/settings";
import { loadSettings, saveSettings } from "../lib/storage";
import { readThemeHint, saveThemeHint } from "../lib/theme";

export const useSettingsStore = defineStore("settings", () => {
  const preferences = shallowRef<AppSettings>({ ...DEFAULT_SETTINGS, theme: readThemeHint() });
  const ready = ref(false);
  const saving = ref(false);
  const saveFailed = ref(false);
  const status = ref("");
  const albumGrouping = computed(() => preferences.value.albumGrouping);
  const librarySort = computed(() => readonly(preferences.value.librarySort));
  const theme = computed(() => preferences.value.theme);
  let restoreRequest: Promise<void> | undefined;
  let writes: Promise<void> = Promise.resolve();
  let revision = 0;

  function restore(): Promise<void> {
    restoreRequest ??= (async () => {
      try {
        const saved = parseSettings(await loadSettings());
        preferences.value = saved;
        saveThemeHint(saved.theme);
      } catch {
        status.value =
          "設定を読み込めませんでした。起動時のテーマとライブラリの初期設定を使用します。";
      } finally {
        ready.value = true;
      }
    })();
    return restoreRequest;
  }

  function persist(): Promise<void> {
    const changed = ++revision;
    const snapshot = preferences.value;
    saving.value = true;
    status.value = "";
    saveFailed.value = false;
    // Write immutable snapshots in order. Publish the startup hint only after
    // the corresponding IndexedDB transaction has committed.
    writes = writes.then(async () => {
      try {
        await saveSettings(snapshot);
        saveThemeHint(snapshot.theme);
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
    return writes;
  }

  function update(change: (current: AppSettings) => AppSettings): Promise<void> {
    // Merge an early change into the restored settings before writing it.
    if (!ready.value) return restore().then(() => update(change));
    preferences.value = change(preferences.value);
    return persist();
  }

  function setAlbumGrouping(grouping: unknown): Promise<void> | undefined {
    if (isAlbumGrouping(grouping))
      return update((current) => ({ ...current, albumGrouping: grouping }));
  }

  function setSortKey(view: unknown, key: unknown): Promise<void> | undefined {
    if (isSortView(view) && isSortKey(view, key)) {
      return update((current) => ({
        ...current,
        librarySort: {
          ...current.librarySort,
          [view]: { ...current.librarySort[view], key },
        },
      }));
    }
  }

  function setSortDirection(view: unknown, direction: unknown): Promise<void> | undefined {
    if (isSortView(view) && isSortDirection(direction)) {
      return update((current) => ({
        ...current,
        librarySort: {
          ...current.librarySort,
          [view]: { ...current.librarySort[view], direction },
        },
      }));
    }
  }

  function setTheme(theme: unknown): Promise<void> | undefined {
    if (isTheme(theme)) return update((current) => ({ ...current, theme }));
  }

  function retrySave(): Promise<void> | undefined {
    if (saveFailed.value) return persist();
  }

  return {
    preferences: readonly(preferences),
    albumGrouping,
    librarySort,
    theme,
    ready: readonly(ready),
    saving: readonly(saving),
    saveFailed: readonly(saveFailed),
    status: readonly(status),
    restore,
    setAlbumGrouping,
    setSortKey,
    setSortDirection,
    setTheme,
    retrySave,
  };
});
