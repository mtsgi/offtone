import type { MusicDirectory } from "./library";

const DATABASE = "offtone";
const STORE = "settings";
const DIRECTORY_KEY = "music-directory";

/** 音声データを保存せずにフォルダーのハンドルを読み書きする。 */
async function directoryStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => {
        database.close();
        resolve(request.result);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

/** 選択したフォルダーのハンドルを保存する。 */
export function saveDirectory(directory: MusicDirectory): Promise<IDBValidKey> {
  return directoryStore("readwrite", (store) => store.put(directory, DIRECTORY_KEY));
}

/** 前回選択したフォルダーのハンドルがあれば読み込む。 */
export function loadDirectory(): Promise<MusicDirectory | undefined> {
  return directoryStore("readonly", (store) => store.get(DIRECTORY_KEY));
}

/** フォルダーへの読み取り権限を確認する。 */
export function queryDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.queryPermission({ mode: "read" });
}

/** ユーザー操作に応じてフォルダーへの読み取り権限を要求する。 */
export function requestDirectoryPermission(directory: MusicDirectory): Promise<PermissionState> {
  return directory.requestPermission({ mode: "read" });
}
