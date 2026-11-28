import { assertTrackInRoot, type RootId, type TrackId } from "./catalog";
import {
  PLAYLISTS,
  PLAYLIST_ENTRIES,
  deleteByPrefix,
  readIndex,
  readRequest,
  runTransaction,
} from "./indexed-db";

export type PlaylistId = string;
export type PlaylistEntryId = string;

export interface Playlist {
  id: PlaylistId;
  rootId: RootId;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistEntry {
  id: PlaylistEntryId;
  playlistId: PlaylistId;
  trackId: TrackId;
  position: number;
}

const ENTRY_ORDER = "byPlaylistPosition";
const PLAYLIST_WITH_ENTRIES = [PLAYLISTS, PLAYLIST_ENTRIES];

function playlistName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new TypeError("Playlist name must not be blank");
  return trimmed;
}

async function readPlaylist(
  store: IDBObjectStore,
  rootId: RootId,
  playlistId: PlaylistId,
): Promise<Playlist | undefined> {
  const playlist: Playlist | undefined = await readRequest(store.get(playlistId));
  return playlist?.rootId === rootId ? playlist : undefined;
}

async function updatePlaylist(store: IDBObjectStore, playlist: Playlist): Promise<Playlist> {
  const updated = { ...playlist, updatedAt: Math.max(playlist.updatedAt, Date.now()) };
  await readRequest(store.put(updated));
  return updated;
}

export function listPlaylists(rootId: RootId): Promise<Playlist[]> {
  return runTransaction([PLAYLISTS], "readonly", (tx) =>
    readIndex(tx.objectStore(PLAYLISTS).index("byRootUpdatedAt"), rootId, "prev"),
  );
}

export function getPlaylist(rootId: RootId, playlistId: PlaylistId): Promise<Playlist | undefined> {
  return runTransaction([PLAYLISTS], "readonly", (tx) =>
    readPlaylist(tx.objectStore(PLAYLISTS), rootId, playlistId),
  );
}

export async function createPlaylist(rootId: RootId, name: string): Promise<Playlist> {
  if (!rootId) throw new TypeError("Expected a registered root ID");
  const now = Date.now();
  const playlist: Playlist = {
    id: crypto.randomUUID(),
    rootId,
    name: playlistName(name),
    createdAt: now,
    updatedAt: now,
  };
  await runTransaction([PLAYLISTS], "readwrite", (tx) =>
    readRequest(tx.objectStore(PLAYLISTS).add(playlist)),
  );
  return playlist;
}

export async function renamePlaylist(
  rootId: RootId,
  playlistId: PlaylistId,
  name: string,
): Promise<Playlist | undefined> {
  const trimmed = playlistName(name);
  return runTransaction([PLAYLISTS], "readwrite", async (tx) => {
    const store = tx.objectStore(PLAYLISTS);
    const playlist = await readPlaylist(store, rootId, playlistId);
    if (!playlist) return undefined;
    return updatePlaylist(store, { ...playlist, name: trimmed });
  });
}

export function deletePlaylist(rootId: RootId, playlistId: PlaylistId): Promise<boolean> {
  return runTransaction(PLAYLIST_WITH_ENTRIES, "readwrite", async (tx) => {
    const playlists = tx.objectStore(PLAYLISTS);
    if (!(await readPlaylist(playlists, rootId, playlistId))) return false;
    await deleteByPrefix(tx.objectStore(PLAYLIST_ENTRIES), ENTRY_ORDER, playlistId);
    await readRequest(playlists.delete(playlistId));
    return true;
  });
}

export function listPlaylistEntries(
  rootId: RootId,
  playlistId: PlaylistId,
): Promise<PlaylistEntry[] | undefined> {
  return runTransaction(PLAYLIST_WITH_ENTRIES, "readonly", async (tx) => {
    if (!(await readPlaylist(tx.objectStore(PLAYLISTS), rootId, playlistId))) return undefined;
    return readIndex(tx.objectStore(PLAYLIST_ENTRIES).index(ENTRY_ORDER), playlistId, "next");
  });
}

export async function addPlaylistEntry(
  rootId: RootId,
  playlistId: PlaylistId,
  trackId: TrackId,
): Promise<PlaylistEntry | undefined> {
  assertTrackInRoot(rootId, trackId);
  return runTransaction(PLAYLIST_WITH_ENTRIES, "readwrite", async (tx) => {
    const playlists = tx.objectStore(PLAYLISTS);
    const playlist = await readPlaylist(playlists, rootId, playlistId);
    if (!playlist) return undefined;

    const entries = tx.objectStore(PLAYLIST_ENTRIES);
    const [last] = await readIndex<PlaylistEntry>(
      entries.index(ENTRY_ORDER),
      playlistId,
      "prev",
      1,
    );
    const entry: PlaylistEntry = {
      id: crypto.randomUUID(),
      playlistId,
      trackId,
      position: (last?.position ?? -1) + 1,
    };
    await readRequest(entries.add(entry));
    await updatePlaylist(playlists, playlist);
    return entry;
  });
}

export function removePlaylistEntry(
  rootId: RootId,
  playlistId: PlaylistId,
  entryId: PlaylistEntryId,
): Promise<boolean> {
  return runTransaction(PLAYLIST_WITH_ENTRIES, "readwrite", async (tx) => {
    const playlists = tx.objectStore(PLAYLISTS);
    const playlist = await readPlaylist(playlists, rootId, playlistId);
    if (!playlist) return false;
    const entries = tx.objectStore(PLAYLIST_ENTRIES);
    const entry: PlaylistEntry | undefined = await readRequest(entries.get(entryId));
    if (entry?.playlistId !== playlistId) return false;

    await readRequest(entries.delete(entryId));
    await updatePlaylist(playlists, playlist);
    return true;
  });
}

/** Return false if the playlist or its entry set changed before the write. */
export function reorderPlaylistEntries(
  rootId: RootId,
  playlistId: PlaylistId,
  entryIds: readonly PlaylistEntryId[],
): Promise<boolean> {
  const order = new Set(entryIds);
  if (order.size !== entryIds.length) return Promise.resolve(false);
  return runTransaction(PLAYLIST_WITH_ENTRIES, "readwrite", async (tx) => {
    const playlists = tx.objectStore(PLAYLISTS);
    const playlist = await readPlaylist(playlists, rootId, playlistId);
    if (!playlist) return false;
    const entries = tx.objectStore(PLAYLIST_ENTRIES);
    const current = await readIndex<PlaylistEntry>(entries.index(ENTRY_ORDER), playlistId, "next");
    const byId = new Map(current.map((entry) => [entry.id, entry]));
    if (order.size !== byId.size || current.some((entry) => !order.has(entry.id))) return false;

    let position = 0;
    for (const id of order) {
      const entry = byId.get(id)!;
      if (entry.position !== position) await readRequest(entries.put({ ...entry, position }));
      position++;
    }
    await updatePlaylist(playlists, playlist);
    return true;
  });
}
