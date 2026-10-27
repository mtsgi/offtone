import { ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { scanDirectory, type MusicDirectory } from "../lib/library";
import {
  loadDirectory,
  saveDirectory,
  queryDirectoryPermission,
  requestDirectoryPermission,
} from "../lib/storage";
import { usePlayerStore } from "./player";

/** フォルダーの選択、アクセス権、曲一覧の更新を管理する。 */
export const useLibraryStore = defineStore("library", () => {
  const player = usePlayerStore();
  const directory = shallowRef<MusicDirectory>();
  const folderName = ref("");
  const status = ref("");
  const busy = ref(false);
  const needsPermission = ref(false);
  const supported = "showDirectoryPicker" in window;

  /** 現在のフォルダーを読み込み、再生キューを更新する。 */
  async function refresh(): Promise<void> {
    if (!directory.value) return;
    busy.value = true;
    status.value = "";
    try {
      const found = await scanDirectory(directory.value);
      player.setTracks(found);
      folderName.value = directory.value.name;
      needsPermission.value = false;
    } catch {
      status.value = "フォルダーを読み込めませんでした。もう一度選択してください。";
    } finally {
      busy.value = false;
    }
  }

  /** ユーザーが選択した音楽フォルダーへのアクセスを要求する。 */
  async function selectFolder(): Promise<void> {
    if (!supported) return;
    try {
      const picker = window as unknown as Window & {
        showDirectoryPicker(options: { mode: "read" }): Promise<MusicDirectory>;
      };
      const selected = await picker.showDirectoryPicker({ mode: "read" });
      directory.value = selected;
      let saved = true;
      try {
        await saveDirectory(selected);
      } catch {
        saved = false;
      }
      await refresh();
      if (!saved && !status.value) {
        status.value = "フォルダーを記憶できませんでした。次回は再選択してください。";
      }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        status.value = "フォルダーを開けませんでした。別のフォルダーを選んでください。";
      }
    }
  }

  /** 保存済みのフォルダーに対する読み取り権限を再要求する。 */
  async function restorePermission(): Promise<void> {
    if (!directory.value) return;
    try {
      if ((await requestDirectoryPermission(directory.value)) === "granted") {
        await refresh();
      } else {
        status.value = "フォルダーへのアクセスが許可されませんでした。";
      }
    } catch {
      status.value = "フォルダーにアクセスできません。もう一度選択してください。";
    }
  }

  /** 保存済みのフォルダーがあれば、権限を確認して復元する。 */
  async function restore(): Promise<void> {
    if (!supported) return;
    try {
      const saved = await loadDirectory();
      if (!saved) return;
      directory.value = saved;
      folderName.value = saved.name;
      if ((await queryDirectoryPermission(saved)) === "granted") {
        await refresh();
      } else {
        needsPermission.value = true;
      }
    } catch {
      status.value = "前回のフォルダーを復元できませんでした。もう一度選択してください。";
    }
  }

  return {
    directory,
    folderName,
    status,
    busy,
    needsPermission,
    supported,
    refresh,
    selectFolder,
    restorePermission,
    restore,
  };
});
