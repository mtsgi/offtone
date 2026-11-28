const DATABASE = "offtone";
const VERSION = 3;
export const SETTINGS = "settings";
export const ROOTS = "roots";
export const TRACKS = "tracks";
export const FAVORITES = "favorites";
export const PLAYLISTS = "playlists";
export const PLAYLIST_ENTRIES = "playlistEntries";
export const PLAY_HISTORY = "playHistory";
export const PLAY_STATS = "playStats";

function addLibraryStores(db: IDBDatabase): void {
  const favorites = db.createObjectStore(FAVORITES, { keyPath: "trackId" });
  favorites.createIndex("byRootAddedAt", ["rootId", "addedAt"]);

  const playlists = db.createObjectStore(PLAYLISTS, { keyPath: "id" });
  playlists.createIndex("byRootUpdatedAt", ["rootId", "updatedAt"]);

  const entries = db.createObjectStore(PLAYLIST_ENTRIES, { keyPath: "id" });
  entries.createIndex("byPlaylistPosition", ["playlistId", "position"]);

  const history = db.createObjectStore(PLAY_HISTORY, { keyPath: "id" });
  history.createIndex("byRootPlayedAt", ["rootId", "playedAt"]);

  const stats = db.createObjectStore(PLAY_STATS, { keyPath: "trackId" });
  stats.createIndex("byRootLastPlayedAt", ["rootId", "lastPlayedAt"]);
  stats.createIndex("byRootPlayCount", ["rootId", "playCount", "lastPlayedAt"]);
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
    open.onupgradeneeded = (event) => {
      const db = open.result;
      // ストアの追加だけを行う。失敗すれば旧バージョンとそのデータは保持される。
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      if (!db.objectStoreNames.contains(ROOTS)) db.createObjectStore(ROOTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TRACKS)) {
        const tracks = db.createObjectStore(TRACKS, { keyPath: "id" });
        tracks.createIndex("rootId", "rootId");
      }
      if (event.oldVersion < 3) addLibraryStores(db);
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

export function readRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Await only IndexedDB requests inside action. Report success after commit. */
export async function runTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const db = await openDatabase();
  let tx: IDBTransaction | undefined;
  const abort = () => {
    try {
      tx?.abort();
    } catch {
      // Already complete or aborted.
    }
  };

  try {
    signal?.throwIfAborted();
    const active = db.transaction(stores, mode);
    tx = active;
    signal?.addEventListener("abort", abort, { once: true });
    const completed = new Promise<void>((resolve, reject) => {
      let requestError: DOMException | null = null;
      active.addEventListener("error", (event) => {
        requestError ??= (event.target as IDBRequest).error ?? active.error;
      });
      active.oncomplete = () => resolve();
      active.onabort = () =>
        reject(requestError ?? active.error ?? new DOMException("Aborted", "AbortError"));
    });
    try {
      const [, result] = await Promise.all([completed, action(active)]);
      return result;
    } catch (cause) {
      abort();
      const transactionCause: unknown = await completed.catch((error: unknown) => error);
      if (cause instanceof DOMException && cause.name === "AbortError") {
        throw transactionCause ?? cause;
      }
      throw cause;
    }
  } catch (cause) {
    throw storageError(cause);
  } finally {
    signal?.removeEventListener("abort", abort);
    db.close();
  }
}

/** The first field is a root or playlist ID. Remaining indexed fields are numbers. */
export function indexPrefix(id: string): IDBKeyRange {
  return IDBKeyRange.bound([id], [id, []], false, true);
}

export function readIndex<T>(
  index: IDBIndex,
  id: string,
  direction: IDBCursorDirection,
  limit = Infinity,
): Promise<T[]> {
  if (limit === 0) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const records: T[] = [];
    const request = index.openCursor(indexPrefix(id), direction);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      records.push(cursor.value);
      if (records.length >= limit) resolve(records);
      else cursor.continue();
    };
  });
}

export async function deleteByPrefix(
  store: IDBObjectStore,
  index: string,
  id: string,
): Promise<void> {
  const keys = await readRequest(store.index(index).getAllKeys(indexPrefix(id)));
  for (const key of keys) await readRequest(store.delete(key));
}
