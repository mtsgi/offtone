import { computed, ref, shallowRef } from "vue";
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
  const permissionDirectory = shallowRef<MusicDirectory>();
  const permissionFolderName = computed(() => permissionDirectory.value?.name ?? folderName.value);
  const supported = "showDirectoryPicker" in window;
  // キューに反映済みのルート。名前だけでは別フォルダーを区別できない。
  let queueDirectory: MusicDirectory | undefined;
  let generation = 0;
  let saves: Promise<void> = Promise.resolve();

  function begin(): number {
    const run = ++generation;
    busy.value = true;
    status.value = "";
    return run;
  }

  async function scan(selected: MusicDirectory, run: number): Promise<boolean> {
    try {
      const found = await scanDirectory(selected);
      if (run !== generation) return false;
      const same =
        queueDirectory === selected ||
        (queueDirectory !== undefined && (await queueDirectory.isSameEntry(selected)));
      if (run !== generation) return false;
      if (same) player.updateTracks(found);
      else player.setTracks(found);
      queueDirectory = selected;
      directory.value = selected;
      folderName.value = selected.name;
      needsPermission.value = false;
      permissionDirectory.value = undefined;
      return true;
    } catch (cause) {
      if (run === generation) {
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          permissionDirectory.value = selected;
          needsPermission.value = true;
        }
        status.value = "フォルダーを読み込めませんでした。もう一度お試しください。";
      }
      return false;
    }
  }

  async function saveSelection(selected: MusicDirectory, run: number): Promise<void> {
    // 保存要求を直列化し、遅い古い書き込みが新しい選択を上書きしないようにする。
    saves = saves
      .catch(() => {})
      .then(async () => {
        await saveDirectory(selected);
      });
    try {
      await saves;
    } catch {
      if (run === generation) {
        status.value = "フォルダーを記憶できませんでした。次回は再選択してください。";
      }
    }
  }

  /** 現在のフォルダーを読み込み、再生キューを更新する。 */
  async function refresh(): Promise<void> {
    const selected = directory.value;
    if (!selected) return;
    const run = begin();
    try {
      await scan(selected, run);
    } finally {
      if (run === generation) busy.value = false;
    }
  }

  /** ユーザーが選択した音楽フォルダーへのアクセスを要求する。 */
  async function selectFolder(): Promise<void> {
    if (!supported) return;
    const run = begin();
    try {
      const picker = window as unknown as Window & {
        showDirectoryPicker(options: { mode: "read" }): Promise<MusicDirectory>;
      };
      const selected = await picker.showDirectoryPicker({ mode: "read" });
      if (run !== generation || !(await scan(selected, run))) return;
      await saveSelection(selected, run);
    } catch (cause) {
      if (run === generation && !(cause instanceof DOMException && cause.name === "AbortError")) {
        status.value = "フォルダーを開けませんでした。別のフォルダーを選んでください。";
      }
    } finally {
      if (run === generation) busy.value = false;
    }
  }

  /** 保存済みのフォルダーに対する読み取り権限を再要求する。 */
  async function restorePermission(): Promise<void> {
    const selected = permissionDirectory.value ?? directory.value;
    if (!selected) return;
    const saveAfterRecovery =
      permissionDirectory.value === selected && selected !== directory.value;
    const run = begin();
    try {
      const permission = await requestDirectoryPermission(selected);
      if (run !== generation) return;
      if (permission === "granted") {
        if (await scan(selected, run)) {
          if (saveAfterRecovery) await saveSelection(selected, run);
        }
      } else {
        needsPermission.value = true;
        status.value = "フォルダーへのアクセスが許可されませんでした。";
      }
    } catch {
      if (run === generation)
        status.value = "フォルダーにアクセスできません。もう一度選択してください。";
    } finally {
      if (run === generation) busy.value = false;
    }
  }

  /** 保存済みのフォルダーがあれば、権限を確認して復元する。 */
  async function restore(): Promise<void> {
    if (!supported) return;
    const run = begin();
    try {
      const saved = await loadDirectory();
      if (run !== generation || !saved) return;
      const permission = await queryDirectoryPermission(saved);
      if (run !== generation) return;
      if (permission === "granted") {
        if (!directory.value) {
          directory.value = saved;
          folderName.value = saved.name;
        }
        await scan(saved, run);
      } else {
        directory.value = saved;
        folderName.value = saved.name;
        permissionDirectory.value = saved;
        needsPermission.value = true;
      }
    } catch {
      if (run === generation)
        status.value = "前回のフォルダーを復元できませんでした。もう一度選択してください。";
    } finally {
      if (run === generation) busy.value = false;
    }
  }

  return {
    directory,
    folderName,
    status,
    busy,
    needsPermission,
    permissionFolderName,
    supported,
    refresh,
    selectFolder,
    restorePermission,
    restore,
  };
});
