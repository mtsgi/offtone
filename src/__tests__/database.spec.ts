import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Blob } from "node:buffer";
import {
  getTrack,
  loadDirectory,
  loadPlayback,
  loadSettings,
  putTrack,
  saveDirectory,
  savePlayback,
  saveSettings,
  StorageError,
} from "../lib/storage";
import type { MusicDirectory } from "../lib/library";
import { trackId } from "../lib/catalog";
import type { SavedPlayback } from "../lib/playback-session";
import { parseSettings } from "../lib/settings";

const STORES_V3 = [
  "favorites",
  "playHistory",
  "playStats",
  "playlistEntries",
  "playlists",
  "roots",
  "settings",
  "tracks",
];

function open(version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("offtone", version);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("settings");
      if (version === 2) {
        request.result.createObjectStore("roots", { keyPath: "id" });
        const tracks = request.result.createObjectStore("tracks", { keyPath: "id" });
        tracks.createIndex("rootId", "rootId");
      }
    };
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

describe("IndexedDB v3", () => {
  it("新規 DB にフォルダー・設定・タグ・ルート別の再生状態を保存する", async () => {
    const dir = folder("a");
    const rootId = await saveDirectory(dir);
    const id = trackId(rootId, "song.mp3");
    const record = { id, rootId, path: "song.mp3", size: 5, lastModified: 10 };
    const settings = parseSettings({ theme: "dark" });
    await putTrack(record);
    await saveSettings(settings);
    const playback: SavedPlayback = {
      version: 1,
      rootId,
      library: [id],
      queue: [id, id],
      edited: true,
      order: [1, 0],
      current: 1,
      position: 19,
      shuffle: true,
      repeat: "off",
      volume: 0.5,
    };
    const other = {
      ...playback,
      rootId: "other",
      library: [],
      queue: [],
      order: [],
      current: null,
      position: 0,
    };
    await Promise.all([savePlayback(playback), savePlayback(other)]);
    expect(await loadPlayback(rootId)).toEqual(playback);
    expect(await loadPlayback("other")).toEqual(other);
    expect(await loadPlayback("unknown")).toBeUndefined();
    expect(await loadDirectory()).toEqual(dir);
    expect(await loadSettings()).toEqual(settings);
    expect(await getTrack(id)).toEqual(record);
    const db = await open(3);
    expect([...db.objectStoreNames]).toEqual(STORES_V3);
    db.close();
  });

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
    const upgraded = await open(3);
    expect([...upgraded.objectStoreNames]).toEqual(STORES_V3);
    const request = upgraded.transaction("settings").objectStore("settings").get("another-setting");
    await new Promise<void>((resolve) => {
      request.onsuccess = () => resolve();
    });
    expect(request.result).toBe("keep");
    upgraded.close();
  });

  it("v2 の設定、再生状態、ルート、タグとアートワークを保持してアップグレードする", async () => {
    const dir = folder("legacy");
    const rootId = "existing-root";
    const id = trackId(rootId, "song.mp3");
    const settings = parseSettings({ theme: "dark" });
    const playback: SavedPlayback = {
      version: 1,
      rootId,
      library: [id],
      queue: [id, id],
      edited: true,
      order: [1, 0],
      current: 1,
      position: 19,
      shuffle: true,
      repeat: "all",
      volume: 0.5,
    };
    const { artwork, ...track } = {
      id,
      rootId,
      path: "song.mp3",
      size: 123,
      lastModified: 456,
      metadata: { title: "Tagged", artworkRef: id },
      metadataVersion: 5,
      artwork: new Blob(["thumbnail"], { type: "image/png" }),
    };
    const db = await open(2);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["settings", "roots", "tracks"], "readwrite");
      const preferences = tx.objectStore("settings");
      preferences.put(dir, "music-directory");
      preferences.put(settings, "app-settings");
      preferences.put(playback, ["playback", rootId]);
      tx.objectStore("roots").put({ id: rootId, handle: dir });
      tx.objectStore("tracks").put({ ...track, artwork });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();

    expect(await loadDirectory()).toEqual(dir);
    expect(await loadSettings()).toEqual(settings);
    expect(await loadPlayback(rootId)).toEqual(playback);
    expect(await saveDirectory(dir)).toBe(rootId);
    const preserved = await getTrack(id);
    expect(preserved).toMatchObject(track);
    expect(preserved?.artwork?.type).toBe("image/png");
    expect(await preserved?.artwork?.text()).toBe("thumbnail");
    const upgraded = await open(3);
    expect([...upgraded.objectStoreNames]).toEqual(STORES_V3);
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
      if (name === "playStats") queueMicrotask(() => store.transaction.abort());
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
    await expect(loadDirectory()).rejects.toMatchObject({ kind: "blocked" });
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
