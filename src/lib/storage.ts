import type { AppSettings } from "./settings";
import type { MusicDirectory } from "./library";
import type { RootId, TrackId, TrackRecord } from "./catalog";
import type { SavedPlayback } from "./playback-session";
import { ROOTS, SETTINGS, TRACKS, readRequest, runTransaction } from "./indexed-db";

export { StorageError } from "./indexed-db";

const DIRECTORY_KEY = "music-directory";
const APP_SETTINGS_KEY = "app-settings";

export interface RootRecord {
  id: RootId;
  handle: MusicDirectory;
}

function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => IDBRequest<T>,
  signal?: AbortSignal,
): Promise<T> {
  return runTransaction(stores, mode, (tx) => readRequest(action(tx)), signal);
}

async function saveDirectoryUnlocked(directory: MusicDirectory): Promise<RootId> {
  const roots = await transaction<RootRecord[]>([ROOTS], "readonly", (tx) =>
    tx.objectStore(ROOTS).getAll(),
  );
  let existing: RootRecord | undefined;
  for (const root of roots) {
    try {
      if (await root.handle.isSameEntry(directory)) {
        existing = root;
        break;
      }
    } catch {
      // 古いハンドルを比較できない場合、名前で同一と判定しない。
    }
  }
  const id = existing?.id ?? crypto.randomUUID();
  await transaction([SETTINGS, ROOTS], "readwrite", (tx) => {
    tx.objectStore(ROOTS).put({ id, handle: directory } satisfies RootRecord);
    return tx.objectStore(SETTINGS).put(directory, DIRECTORY_KEY);
  });
  return id;
}

let directorySaves: Promise<unknown> = Promise.resolve();

/** ハンドルは構造化複製で保存し、音声データは保存しない。 */
export function saveDirectory(directory: MusicDirectory): Promise<RootId> {
  // 比較は非同期であり IDB トランザクションの中に置けないため、登録全体を直列化する。
  const save = () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("offtone-directory-registration", () =>
          saveDirectoryUnlocked(directory),
        )
      : saveDirectoryUnlocked(directory);
  const result = directorySaves.catch(() => {}).then(save);
  directorySaves = result;
  return result;
}

export function loadDirectory(): Promise<MusicDirectory | undefined> {
  return transaction([SETTINGS], "readonly", (tx) => tx.objectStore(SETTINGS).get(DIRECTORY_KEY));
}

export function getTrack(id: TrackId): Promise<TrackRecord | undefined> {
  return transaction([TRACKS], "readonly", (tx) => tx.objectStore(TRACKS).get(id));
}

export function putTrack(record: TrackRecord, signal?: AbortSignal): Promise<IDBValidKey> {
  return transaction([TRACKS], "readwrite", (tx) => tx.objectStore(TRACKS).put(record), signal);
}

export function listTrackIds(rootId: RootId): Promise<IDBValidKey[]> {
  return transaction([TRACKS], "readonly", (tx) =>
    tx.objectStore(TRACKS).index("rootId").getAllKeys(rootId),
  );
}

export function deleteTrack(id: TrackId, signal?: AbortSignal): Promise<undefined> {
  return transaction([TRACKS], "readwrite", (tx) => tx.objectStore(TRACKS).delete(id), signal);
}

export function queryDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.queryPermission({ mode: "read" });
}

export function requestDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.requestPermission({ mode: "read" });
}

/** Preferences use their own key; directory handles and the DB schema stay intact. */
export function loadSettings(): Promise<unknown> {
  return transaction([SETTINGS], "readonly", (tx) =>
    tx.objectStore(SETTINGS).get(APP_SETTINGS_KEY),
  );
}
export function saveSettings(settings: AppSettings): Promise<IDBValidKey> {
  return transaction([SETTINGS], "readwrite", (tx) =>
    tx.objectStore(SETTINGS).put(settings, APP_SETTINGS_KEY),
  );
}

export function loadPlayback(rootId: RootId): Promise<unknown> {
  return transaction([SETTINGS], "readonly", (tx) =>
    tx.objectStore(SETTINGS).get(["playback", rootId]),
  );
}

export function savePlayback(playback: SavedPlayback): Promise<IDBValidKey> {
  return transaction([SETTINGS], "readwrite", (tx) =>
    tx.objectStore(SETTINGS).put(playback, ["playback", playback.rootId]),
  );
}
