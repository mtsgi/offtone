import type { MusicDirectory } from "./library";
import type { RootId, TrackId, TrackRecord } from "./catalog";

const DATABASE = "offtone";
const VERSION = 2;
const SETTINGS = "settings";
const ROOTS = "roots";
const TRACKS = "tracks";
const DIRECTORY_KEY = "music-directory";

export interface RootRecord {
  id: RootId;
  handle: MusicDirectory;
}

/** DB を消去せず、原因を UI に伝えられるようにする。 */
export class StorageError extends Error {
  constructor(
    public readonly kind: "blocked" | "quota" | "unavailable",
    public readonly cause?: unknown,
  ) {
    super(`IndexedDB: ${kind}`);
    this.name = "StorageError";
  }
}

function storageError(cause: unknown): StorageError {
  return cause instanceof StorageError
    ? cause
    : new StorageError(
        cause instanceof DOMException && cause.name === "QuotaExceededError"
          ? "quota"
          : "unavailable",
        cause,
      );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let open: IDBOpenDBRequest;
    try {
      open = indexedDB.open(DATABASE, VERSION);
    } catch (cause) {
      reject(storageError(cause));
      return;
    }
    open.onupgradeneeded = () => {
      const db = open.result;
      // upgrade は原子的。失敗すれば v1 とその設定は保持される。
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      if (!db.objectStoreNames.contains(ROOTS)) db.createObjectStore(ROOTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRACKS)) {
        const tracks = db.createObjectStore(TRACKS, { keyPath: "id" });
        tracks.createIndex("rootId", "rootId");
      }
    };
    open.onblocked = () => {
      settled = true;
      reject(new StorageError("blocked"));
    };
    open.onerror = () => {
      settled = true;
      reject(storageError(open.error));
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => db.close();
      if (settled) db.close();
      else {
        settled = true;
        resolve(db);
      }
    };
  });
}

async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    let request: IDBRequest<T>;
    let requestError: DOMException | null = null;
    try {
      tx = db.transaction(stores, mode);
      request = action(tx);
      const activeTransaction = tx;
      tx.addEventListener("error", (event) => {
        requestError = (event.target as IDBRequest).error ?? activeTransaction.error;
      });
    } catch (cause) {
      try {
        tx?.abort();
      } catch {
        // トランザクションが既に終了していればそのまま報告する。
      }
      db.close();
      reject(storageError(cause));
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = () => {
      db.close();
      reject(storageError(requestError ?? tx.error));
    };
  });
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

export function putTrack(record: TrackRecord): Promise<IDBValidKey> {
  return transaction([TRACKS], "readwrite", (tx) => tx.objectStore(TRACKS).put(record));
}

export function deleteTrack(id: TrackId): Promise<undefined> {
  return transaction([TRACKS], "readwrite", (tx) => tx.objectStore(TRACKS).delete(id));
}

export function queryDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.queryPermission({ mode: "read" });
}

export function requestDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.requestPermission({ mode: "read" });
}
