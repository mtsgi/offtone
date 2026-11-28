import { assertTrackInRoot, type RootId, type TrackId } from "./catalog";
import { FAVORITES, readIndex, readRequest, runTransaction } from "./indexed-db";

export interface Favorite {
  trackId: TrackId;
  rootId: RootId;
  addedAt: number;
}

export function listFavorites(rootId: RootId): Promise<Favorite[]> {
  return runTransaction([FAVORITES], "readonly", (tx) =>
    readIndex(tx.objectStore(FAVORITES).index("byRootAddedAt"), rootId, "prev"),
  );
}

export async function getFavorite(rootId: RootId, trackId: TrackId): Promise<Favorite | undefined> {
  assertTrackInRoot(rootId, trackId);
  return runTransaction([FAVORITES], "readonly", (tx) =>
    readRequest(tx.objectStore(FAVORITES).get(trackId)),
  );
}

export async function addFavorite(rootId: RootId, trackId: TrackId): Promise<Favorite> {
  assertTrackInRoot(rootId, trackId);
  return runTransaction([FAVORITES], "readwrite", async (tx) => {
    const store = tx.objectStore(FAVORITES);
    const existing: Favorite | undefined = await readRequest(store.get(trackId));
    if (existing) return existing;
    const favorite: Favorite = { trackId, rootId, addedAt: Date.now() };
    await readRequest(store.add(favorite));
    return favorite;
  });
}

export async function removeFavorite(rootId: RootId, trackId: TrackId): Promise<void> {
  assertTrackInRoot(rootId, trackId);
  await runTransaction([FAVORITES], "readwrite", (tx) =>
    readRequest(tx.objectStore(FAVORITES).delete(trackId)),
  );
}
