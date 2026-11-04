import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { scanDirectory, type MusicDirectory } from "../lib/library";
import { metadataIsValid, trackId, type TrackRecord } from "../lib/catalog";
import { MetadataWorker } from "../lib/metadata-worker";
import { deleteTrack, getTrack, listTrackIds, putTrack } from "../lib/storage";
import {
  loadDirectory,
  saveDirectory,
  queryDirectoryPermission,
  requestDirectoryPermission,
  StorageError,
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
  const permissionState = ref<PermissionState | "unavailable">("prompt");
  const permissionDirectory = shallowRef<MusicDirectory>();
  const permissionFolderName = computed(() => permissionDirectory.value?.name ?? folderName.value);
  const supported = "showDirectoryPicker" in window;
  // キューに反映済みのルート。名前だけでは別フォルダーを区別できない。
  let queueDirectory: MusicDirectory | undefined;
  let queueRootId: string | undefined;
  let generation = 0;
  let saves: Promise<void> = Promise.resolve();
  const analysis = ref({ active: false, done: 0, total: 0 });
  const analysisStatus = ref("");
  const analysisCancelled = ref(false);
  const worker = new MetadataWorker();
  let analysisRun = 0;
  let abort = new AbortController();
  const artworkUrls = new Map<string, string>();
  const parserVersion = 2;

  function cancelAnalysis(): void {
    if (analysis.value.active) analysisCancelled.value = true;
    analysisRun++;
    abort.abort();
    worker.stop();
    analysis.value = { ...analysis.value, active: false };
  }
  function clearArtwork(): void {
    for (const url of artworkUrls.values()) URL.revokeObjectURL(url);
    artworkUrls.clear();
  }
  onScopeDispose(() => {
    cancelAnalysis();
    clearArtwork();
  });

  async function analyze(): Promise<void> {
    cancelAnalysis();
    const run = analysisRun;
    abort = new AbortController();
    const signal = abort.signal;
    const tracks = [...player.tracks];
    const rootId = queueRootId;
    analysisStatus.value = "";
    analysisCancelled.value = false;
    analysis.value = { active: true, done: 0, total: tracks.length };
    if (typeof Worker === "undefined") {
      analysisStatus.value = "このブラウザーではタグ解析を利用できません。ファイル名を表示します。";
      analysis.value.active = false;
      return;
    }
    for (const track of tracks) {
      if (run !== analysisRun) return;
      try {
        const file = await track.handle.getFile();
        if (run !== analysisRun) return;
        const id = rootId ? trackId(rootId, track.path) : undefined;
        let cached: TrackRecord | undefined;
        if (id) {
          try {
            cached = await getTrack(id);
          } catch {
            analysisStatus.value = "タグのキャッシュを読み込めませんでした。";
          }
        }
        if (run !== analysisRun) return;
        let record: TrackRecord;
        if (cached && metadataIsValid(cached, file, parserVersion)) record = cached;
        else {
          const result = await worker.parse(file);
          if (run !== analysisRun) return;
          record = {
            id: id ?? track.path,
            rootId: rootId ?? "",
            path: track.path,
            size: file.size,
            lastModified: file.lastModified,
            metadataVersion: parserVersion,
            metadata: result.metadata,
            artwork: result.artwork,
          };
          if (result.artwork) record.metadata!.artworkRef = record.id;
          if (id) {
            try {
              await putTrack(record, signal);
            } catch {
              if (run === analysisRun)
                analysisStatus.value =
                  "タグを保存できませんでした。空き容量やブラウザーの設定を確認してください。";
            }
          }
        }
        if (run !== analysisRun) return;
        const old = artworkUrls.get(track.path);
        const url = record.artwork ? URL.createObjectURL(record.artwork) : undefined;
        if (url) artworkUrls.set(track.path, url);
        else artworkUrls.delete(track.path);
        player.updateTrackMetadata(track, record.metadata, url);
        if (old) URL.revokeObjectURL(old);
      } catch {
        // Do not display stale tags when a changed file cannot be parsed.
        if (run !== analysisRun) return;
        const old = artworkUrls.get(track.path);
        artworkUrls.delete(track.path);
        player.updateTrackMetadata(track);
        if (old) URL.revokeObjectURL(old);
      }
      if (run === analysisRun)
        analysis.value = { ...analysis.value, done: analysis.value.done + 1 };
    }
    if (run === analysisRun && rootId) {
      try {
        const present = new Set(tracks.map((track) => trackId(rootId, track.path)));
        const ids = await listTrackIds(rootId);
        for (const id of ids) {
          if (run !== analysisRun) return;
          if (typeof id === "string" && !present.has(id)) await deleteTrack(id, signal);
        }
      } catch {
        if (run === analysisRun)
          analysisStatus.value = "古いタグキャッシュを整理できませんでした。";
      }
    }
    if (run === analysisRun) analysis.value = { ...analysis.value, active: false };
  }

  function begin(): number {
    cancelAnalysis();
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
      if (same) {
        const previous = new Map(player.tracks.map((track) => [track.path, track]));
        for (const track of found) {
          const old = previous.get(track.path);
          if (old) {
            track.metadata = old.metadata;
            track.artworkUrl = old.artworkUrl;
          }
        }
      } else clearArtwork();
      if (same && queueRootId) {
        for (const track of found) track.id = trackId(queueRootId, track.path);
      }
      if (same) player.updateTracks(found);
      else player.setTracks(found);
      const paths = new Set(found.map((track) => track.path));
      for (const [path, url] of artworkUrls) {
        if (!paths.has(path)) {
          URL.revokeObjectURL(url);
          artworkUrls.delete(path);
        }
      }
      if (!same) queueRootId = undefined;
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
          permissionState.value = "prompt";
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
        if (run !== generation) return;
        const id = await saveDirectory(selected);
        if (run === generation && queueDirectory === selected) {
          queueRootId = id;
          for (const track of player.tracks) track.id = trackId(id, track.path);
        }
      });
    try {
      await saves;
    } catch (cause) {
      if (run === generation) {
        status.value =
          cause instanceof StorageError && cause.kind === "quota"
            ? "保存領域が不足しています。空き容量を確保してフォルダーを再選択してください。"
            : cause instanceof StorageError && cause.kind === "blocked"
              ? "保存の更新が別のタブで妨げられています。他のタブを閉じて再試行してください。"
              : "フォルダーを記憶できませんでした。次回は再選択してください。";
      }
    }
  }

  /** 現在のフォルダーを読み込み、再生キューを更新する。 */
  async function refresh(): Promise<void> {
    const selected = directory.value;
    if (!selected) return;
    const run = begin();
    try {
      if (await scan(selected, run)) {
        if (!queueRootId) await saveSelection(selected, run);
        if (run === generation) void analyze();
      }
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
      if (run === generation) void analyze();
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
    const run = begin();
    try {
      const permission = await requestDirectoryPermission(selected);
      if (run !== generation) return;
      if (permission === "granted") {
        if (await scan(selected, run)) {
          await saveSelection(selected, run);
          if (run === generation) void analyze();
        }
      } else {
        needsPermission.value = true;
        permissionState.value = permission;
        status.value =
          "アクセスを許可できませんでした。ブラウザーの設定を確認するか、フォルダーを選び直してください。";
      }
    } catch {
      if (run === generation) {
        needsPermission.value = true;
        permissionState.value = "unavailable";
        status.value =
          "このブラウザーでは再許可できない可能性があります。フォルダーを選び直してください。";
      }
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
      if (
        typeof saved.queryPermission !== "function" ||
        typeof saved.requestPermission !== "function"
      ) {
        status.value = "保存されたフォルダーを利用できません。フォルダーを選び直してください。";
        return;
      }
      const permission = await queryDirectoryPermission(saved);
      if (run !== generation) return;
      if (permission === "granted") {
        if (!directory.value) {
          directory.value = saved;
          folderName.value = saved.name;
        }
        if (await scan(saved, run)) {
          await saveSelection(saved, run);
          if (run === generation) void analyze();
        }
      } else {
        directory.value = saved;
        folderName.value = saved.name;
        permissionDirectory.value = saved;
        needsPermission.value = true;
        permissionState.value = permission;
      }
    } catch (cause) {
      if (run === generation) {
        status.value =
          cause instanceof StorageError && cause.kind === "quota"
            ? "保存領域が不足しています。空き容量を確保してから再読み込みしてください。"
            : cause instanceof StorageError && cause.kind === "blocked"
              ? "保存データの更新が別のタブで妨げられています。他のタブを閉じて再読み込みしてください。"
              : "前回のフォルダーを復元できませんでした。もう一度選択してください。";
      }
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
    permissionState,
    permissionFolderName,
    supported,
    analysis,
    analysisStatus,
    analysisCancelled,
    cancelAnalysis,
    analyze,
    refresh,
    selectFolder,
    restorePermission,
    restore,
  };
});
