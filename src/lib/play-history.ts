import { assertTrackInRoot, type RootId, type TrackId } from "./catalog";
import {
  PLAY_HISTORY,
  PLAY_STATS,
  deleteByPrefix,
  readIndex,
  readRequest,
  runTransaction,
} from "./indexed-db";

export type PlayEventId = string;

export interface PlayEventInput {
  id: PlayEventId;
  trackId: TrackId;
  playedAt: number;
}

export interface PlayHistoryEntry extends PlayEventInput {
  rootId: RootId;
}

export interface PlayStats {
  trackId: TrackId;
  rootId: RootId;
  playCount: number;
  lastPlayedAt: number;
}

export type PlayStatsOrder = "recent" | "most-played";

const HISTORY_AND_STATS = [PLAY_HISTORY, PLAY_STATS];
const HISTORY_ORDER = "byRootPlayedAt";
const STATS_RECENT_ORDER = "byRootLastPlayedAt";

function validateLimit(limit?: number): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError("Expected a non-negative integer limit");
  }
}

export async function listPlayHistory(rootId: RootId, limit?: number): Promise<PlayHistoryEntry[]> {
  validateLimit(limit);
  return runTransaction([PLAY_HISTORY], "readonly", (tx) =>
    readIndex(tx.objectStore(PLAY_HISTORY).index(HISTORY_ORDER), rootId, "prev", limit),
  );
}

export async function listPlayStats(
  rootId: RootId,
  order: PlayStatsOrder = "recent",
  limit?: number,
): Promise<PlayStats[]> {
  validateLimit(limit);
  const index = order === "recent" ? STATS_RECENT_ORDER : "byRootPlayCount";
  return runTransaction([PLAY_STATS], "readonly", (tx) =>
    readIndex(tx.objectStore(PLAY_STATS).index(index), rootId, "prev", limit),
  );
}

export async function getPlayStats(
  rootId: RootId,
  trackId: TrackId,
): Promise<PlayStats | undefined> {
  assertTrackInRoot(rootId, trackId);
  return runTransaction([PLAY_STATS], "readonly", (tx) =>
    readRequest(tx.objectStore(PLAY_STATS).get(trackId)),
  );
}

/** Reuse the event ID when retrying the same play. Return false if it was already recorded. */
export async function recordPlay(rootId: RootId, input: PlayEventInput): Promise<boolean> {
  const { id, trackId, playedAt } = input;
  assertTrackInRoot(rootId, trackId);
  if (!id.trim()) throw new TypeError("Expected a playback event ID");
  if (!Number.isSafeInteger(playedAt) || playedAt < 0) {
    throw new RangeError("Expected an epoch timestamp in milliseconds");
  }
  return runTransaction(HISTORY_AND_STATS, "readwrite", async (tx) => {
    const history = tx.objectStore(PLAY_HISTORY);
    if ((await readRequest(history.getKey(id))) !== undefined) return false;

    const stats = tx.objectStore(PLAY_STATS);
    const previous: PlayStats | undefined = await readRequest(stats.get(trackId));
    await readRequest(history.add({ id, trackId, playedAt, rootId } satisfies PlayHistoryEntry));
    await readRequest(
      stats.put({
        trackId,
        rootId,
        playCount: (previous?.playCount ?? 0) + 1,
        lastPlayedAt: Math.max(previous?.lastPlayedAt ?? playedAt, playedAt),
      } satisfies PlayStats),
    );
    return true;
  });
}

export async function clearPlayHistory(rootId: RootId): Promise<void> {
  await runTransaction(HISTORY_AND_STATS, "readwrite", async (tx) => {
    await deleteByPrefix(tx.objectStore(PLAY_HISTORY), HISTORY_ORDER, rootId);
    await deleteByPrefix(tx.objectStore(PLAY_STATS), STATS_RECENT_ORDER, rootId);
  });
}
