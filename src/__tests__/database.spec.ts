import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { getTrack, loadDirectory, putTrack, saveDirectory, StorageError } from "../lib/storage";
import type { MusicDirectory } from "../lib/library";

function open(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("offtone", version);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function folder(identity: string): MusicDirectory {
  // テスト用ハンドルは構造化複製可能なデータのみを持つ。
  return { name: "Music", identity } as unknown as MusicDirectory;
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  Object.defineProperty(Object.prototype, "isSameEntry", {
    configurable: true,
    value(this: { identity?: string }, other: { identity?: string }) {
      return Promise.resolve(this.identity === other.identity);
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(Object.prototype, "isSameEntry");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("IndexedDB v2", () => {
  it("新規作成し、同じフォルダーは ID を再利用し、同名の別フォルダーは区別する", async () => {
    const first = await saveDirectory(folder("a"));
    expect(await saveDirectory(folder("a"))).toBe(first);
    expect(await saveDirectory(folder("b"))).not.toBe(first);
    expect(await loadDirectory()).toEqual(folder("b"));
    const record = { id: "track", rootId: first, path: "song.mp3", size: 5, lastModified: 10 };
    await putTrack(record);
    expect(await getTrack("track")).toEqual(record);
  });

  it("同じフォルダーの同時登録を直列化して ID を共有する", async () => {
    const [first, second] = await Promise.all([
      saveDirectory(folder("same")),
      saveDirectory(folder("same")),
    ]);
    expect(first).toBe(second);
  });

  it("v1 の設定とハンドルを保持してアップグレードする", async () => {
    const db = await open(1);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(folder("legacy"), "music-directory");
      tx.objectStore("settings").put("keep", "another-setting");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    expect(await loadDirectory()).toEqual(folder("legacy"));
    const id = await saveDirectory(folder("legacy"));
    expect(await saveDirectory(folder("legacy"))).toBe(id);
    const upgraded = await open(2);
    expect([...upgraded.objectStoreNames]).toEqual(["roots", "settings", "tracks"]);
    const request = upgraded.transaction("settings").objectStore("settings").get("another-setting");
    await new Promise<void>((resolve) => {
      request.onsuccess = () => resolve();
    });
    expect(request.result).toBe("keep");
    upgraded.close();
  });

  it("容量不足などの保存失敗を伝え、既存の選択を維持する", async () => {
    await saveDirectory(folder("a"));
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    put.mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await expect(saveDirectory(folder("b"))).rejects.toMatchObject({ kind: "quota" });
    put.mockRestore();
    expect(await loadDirectory()).toEqual(folder("a"));
  });

  it("upgrade の中断後も v1 のハンドルと他の設定を維持する", async () => {
    const db = await open(1);
    await new Promise<void>((resolve) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put(folder("legacy"), "music-directory");
      tx.objectStore("settings").put("keep", "other");
      tx.oncomplete = () => resolve();
    });
    db.close();
    const create = Reflect.get(IDBDatabase.prototype, "createObjectStore") as (
      this: IDBDatabase,
      name: string,
      options?: IDBObjectStoreParameters,
    ) => IDBObjectStore;
    const spy = vi.spyOn(IDBDatabase.prototype, "createObjectStore").mockImplementation(function (
      this: IDBDatabase,
      name,
      options,
    ) {
      const store = create.call(this, name, options);
      if (name === "tracks") queueMicrotask(() => store.transaction.abort());
      return store;
    });
    await expect(loadDirectory()).rejects.toBeInstanceOf(StorageError);
    spy.mockRestore();
    const original = await open(1);
    expect(original.version).toBe(1);
    const read = original.transaction("settings").objectStore("settings");
    const handle = read.get("music-directory");
    const other = read.get("other");
    await new Promise<void>((resolve) => {
      other.onsuccess = () => resolve();
    });
    expect(handle.result).toEqual(folder("legacy"));
    expect(other.result).toBe("keep");
    original.close();
    expect(await loadDirectory()).toEqual(folder("legacy"));
  });

  it("別タブに阻まれた upgrade を報告し、閉じた後に復旧する", async () => {
    const old = await open(1);
    await expect(loadDirectory()).rejects.toBeInstanceOf(StorageError);
    old.close();
    await expect(loadDirectory()).resolves.toBeUndefined();
  });

  it("DB 消失後は初期状態から再選択できる", async () => {
    await saveDirectory(folder("a"));
    vi.stubGlobal("indexedDB", new IDBFactory());
    expect(await loadDirectory()).toBeUndefined();
    await saveDirectory(folder("a"));
    expect(await loadDirectory()).toEqual(folder("a"));
  });
});
