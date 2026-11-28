import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { trackId } from "../lib/catalog";
import { addFavorite, getFavorite, listFavorites, removeFavorite } from "../lib/favorites";
import {
  addPlaylistEntry,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylistEntries,
  listPlaylists,
  removePlaylistEntry,
  renamePlaylist,
  reorderPlaylistEntries,
} from "../lib/playlists";
import {
  clearPlayHistory,
  getPlayStats,
  listPlayHistory,
  listPlayStats,
  recordPlay,
} from "../lib/play-history";
import { deleteTrack, getTrack, putTrack } from "../lib/storage";

const root = "root-a";
const otherRoot = "root-b";
const song = trackId(root, "album/song.mp3");
const otherSong = trackId(otherRoot, "album/song.mp3");
const nextSong = trackId(root, "album/next.mp3");

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("お気に入り", () => {
  it("初回の日時を保持し、同一パスの別ルートを区別する", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    const [first, concurrent] = await Promise.all([
      addFavorite(root, song),
      addFavorite(root, song),
    ]);
    expect(first).toEqual({ trackId: song, rootId: root, addedAt: 100 });
    expect(concurrent).toEqual(first);
    now.mockReturnValue(200);
    const newer = await addFavorite(root, nextSong);
    const other = await addFavorite(otherRoot, otherSong);

    expect(await addFavorite(root, song)).toEqual(first);
    expect(await listFavorites(root)).toEqual([newer, first]);
    expect(await listFavorites(otherRoot)).toEqual([other]);
    await expect(addFavorite(root, otherSong)).rejects.toBeInstanceOf(TypeError);
    await expect(addFavorite(root, "queue-1")).rejects.toBeInstanceOf(TypeError);
    await expect(removeFavorite(otherRoot, song)).rejects.toBeInstanceOf(TypeError);
    await removeFavorite(root, song);
    await removeFavorite(root, song);
    expect(await getFavorite(root, song)).toBeUndefined();
    expect(await getFavorite(otherRoot, otherSong)).toEqual(other);
  });
});

describe("プレイリスト", () => {
  it("ルート別に CRUD でき、重複曲を独立した項目として並べ替え・削除する", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100);
    await expect(createPlaylist(root, "  ")).rejects.toBeInstanceOf(TypeError);
    const playlist = await createPlaylist(root, "  mix  ");
    const other = await createPlaylist(otherRoot, "mix");
    expect(playlist).toMatchObject({ name: "mix", createdAt: 100, updatedAt: 100 });
    expect(await listPlaylists(root)).toEqual([playlist]);
    expect(await listPlaylists(otherRoot)).toEqual([other]);
    expect(await getPlaylist(otherRoot, playlist.id)).toBeUndefined();
    expect(await listPlaylistEntries(root, playlist.id)).toEqual([]);
    expect(await listPlaylistEntries(otherRoot, playlist.id)).toBeUndefined();
    expect(await renamePlaylist(otherRoot, playlist.id, "wrong")).toBeUndefined();
    expect(await deletePlaylist(otherRoot, playlist.id)).toBe(false);
    expect(await addPlaylistEntry(otherRoot, playlist.id, otherSong)).toBeUndefined();
    await expect(addPlaylistEntry(root, playlist.id, otherSong)).rejects.toBeInstanceOf(TypeError);

    now.mockReturnValue(200);
    expect(await renamePlaylist(root, playlist.id, "Updated")).toMatchObject({
      name: "Updated",
      createdAt: 100,
      updatedAt: 200,
    });
    now.mockReturnValue(300);
    const [first, duplicate, last] = await Promise.all([
      addPlaylistEntry(root, playlist.id, song),
      addPlaylistEntry(root, playlist.id, song),
      addPlaylistEntry(root, playlist.id, nextSong),
    ]);
    expect(new Set([first!.id, duplicate!.id, last!.id]).size).toBe(3);
    expect((await listPlaylistEntries(root, playlist.id))?.map((entry) => entry.position)).toEqual([
      0, 1, 2,
    ]);
    expect(await getPlaylist(root, playlist.id)).toMatchObject({ updatedAt: 300 });

    await expect(reorderPlaylistEntries(root, playlist.id, [first!.id])).resolves.toBe(false);
    await expect(
      reorderPlaylistEntries(root, playlist.id, [first!.id, first!.id, last!.id]),
    ).resolves.toBe(false);
    const order = [last!.id, duplicate!.id, first!.id];
    expect(await reorderPlaylistEntries(root, playlist.id, order)).toBe(true);
    expect((await listPlaylistEntries(root, playlist.id))?.map((entry) => entry.id)).toEqual(order);
    expect(await removePlaylistEntry(root, playlist.id, duplicate!.id)).toBe(true);
    expect(await removePlaylistEntry(root, playlist.id, duplicate!.id)).toBe(false);
    expect((await listPlaylistEntries(root, playlist.id))?.map((entry) => entry.id)).toEqual([
      last!.id,
      first!.id,
    ]);

    expect(await deletePlaylist(root, playlist.id)).toBe(true);
    expect(await listPlaylistEntries(root, playlist.id)).toBeUndefined();
    expect(await listPlaylists(otherRoot)).toEqual([other]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("offtone");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction("playlistEntries").objectStore("playlistEntries").count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    expect(count).toBe(0);
  });

  it("削除や並べ替えの途中で失敗した場合は項目と親プレイリストを保持する", async () => {
    const playlist = await createPlaylist(root, "mix");
    const first = await addPlaylistEntry(root, playlist.id, song);
    const second = await addPlaylistEntry(root, playlist.id, nextSong);
    const entries = await listPlaylistEntries(root, playlist.id);
    const saved = await getPlaylist(root, playlist.id);

    const originalDelete = Reflect.get(
      IDBObjectStore.prototype,
      "delete",
    ) as IDBObjectStore["delete"];
    const deleteRequest = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      if (this.name === "playlists") throw new DOMException("Failed", "UnknownError");
      return originalDelete.call(this, key);
    });
    await expect(deletePlaylist(root, playlist.id)).rejects.toMatchObject({ kind: "unavailable" });
    deleteRequest.mockRestore();

    const originalPut = Reflect.get(IDBObjectStore.prototype, "put") as IDBObjectStore["put"];
    const putRequest = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      if (this.name === "playlists") throw new DOMException("Full", "QuotaExceededError");
      return originalPut.call(this, value, key);
    });
    await expect(
      reorderPlaylistEntries(root, playlist.id, [second!.id, first!.id]),
    ).rejects.toMatchObject({ kind: "quota" });
    putRequest.mockRestore();

    expect(await getPlaylist(root, playlist.id)).toEqual(saved);
    expect(await listPlaylistEntries(root, playlist.id)).toEqual(entries);
  });
});

describe("再生履歴と集計", () => {
  it("同じイベントを一度だけ記録し、日時・回数順で現在のルートを取得する", async () => {
    const event = { id: "event", trackId: song, playedAt: 300 };
    const duplicates = await Promise.all([recordPlay(root, event), recordPlay(root, event)]);
    expect(duplicates).toEqual([true, false]);
    expect(await recordPlay(otherRoot, { ...event, trackId: otherSong })).toBe(false);
    await recordPlay(root, { ...event, id: "late-arrival", playedAt: 200 });
    await recordPlay(root, { id: "newer", trackId: nextSong, playedAt: 400 });
    await recordPlay(otherRoot, { id: "other", trackId: otherSong, playedAt: 500 });

    expect(await getPlayStats(root, song)).toEqual({
      trackId: song,
      rootId: root,
      playCount: 2,
      lastPlayedAt: 300,
    });
    expect((await listPlayHistory(root)).map((entry) => entry.id)).toEqual([
      "newer",
      "event",
      "late-arrival",
    ]);
    expect((await listPlayHistory(root, 1)).map((entry) => entry.id)).toEqual(["newer"]);
    expect((await listPlayStats(root)).map((entry) => entry.trackId)).toEqual([nextSong, song]);
    expect((await listPlayStats(root, "most-played", 1)).map((entry) => entry.trackId)).toEqual([
      song,
    ]);
    expect(await listPlayStats(root, "recent", 0)).toEqual([]);
    await expect(listPlayHistory(root, -1)).rejects.toBeInstanceOf(RangeError);
    await expect(recordPlay(otherRoot, event)).rejects.toBeInstanceOf(TypeError);
    await expect(recordPlay(root, { ...event, playedAt: NaN })).rejects.toBeInstanceOf(RangeError);

    await clearPlayHistory(root);
    expect(await listPlayHistory(root)).toEqual([]);
    expect(await listPlayStats(root)).toEqual([]);
    expect(await listPlayHistory(otherRoot)).toHaveLength(1);
    expect(await listPlayStats(otherRoot)).toHaveLength(1);
  });

  it("書き込みやクリアに失敗すると履歴と集計をロールバックし、同じ ID で再試行できる", async () => {
    const event = { id: "event", trackId: song, playedAt: 10 };
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    await expect(recordPlay(root, event)).rejects.toMatchObject({ kind: "quota" });
    put.mockRestore();
    expect(await listPlayHistory(root)).toEqual([]);
    expect(await getPlayStats(root, song)).toBeUndefined();
    expect(await recordPlay(root, event)).toBe(true);

    const originalDelete = Reflect.get(
      IDBObjectStore.prototype,
      "delete",
    ) as IDBObjectStore["delete"];
    const deleteRequest = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (
      this: IDBObjectStore,
      key,
    ) {
      if (this.name === "playStats") throw new DOMException("Failed", "UnknownError");
      return originalDelete.call(this, key);
    });
    await expect(clearPlayHistory(root)).rejects.toMatchObject({ kind: "unavailable" });
    deleteRequest.mockRestore();
    expect(await listPlayHistory(root)).toEqual([{ ...event, rootId: root }]);
    expect(await getPlayStats(root, song)).toMatchObject({ playCount: 1, lastPlayedAt: 10 });
  });
});

it("キャッシュから消えた曲への参照を保持し、同じ Track ID で再解決できる", async () => {
  const track = { id: song, rootId: root, path: "album/song.mp3", size: 5, lastModified: 10 };
  await putTrack(track);
  const favorite = await addFavorite(root, song);
  const playlist = await createPlaylist(root, "mix");
  const entry = await addPlaylistEntry(root, playlist.id, song);
  const event = { id: "event", trackId: song, playedAt: 10 };
  await recordPlay(root, event);
  await deleteTrack(song);

  expect(await getTrack(song)).toBeUndefined();
  expect(await listFavorites(root)).toEqual([favorite]);
  expect(await listPlaylistEntries(root, playlist.id)).toEqual([entry]);
  expect(await listPlayHistory(root)).toEqual([{ ...event, rootId: root }]);
  expect(await getPlayStats(root, song)).toMatchObject({ trackId: song, playCount: 1 });

  await putTrack({ ...track, lastModified: 20 });
  expect(await getTrack((await listFavorites(root))[0]!.trackId)).toEqual({
    ...track,
    lastModified: 20,
  });
});
