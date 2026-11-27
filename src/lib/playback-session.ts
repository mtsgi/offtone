import { trackId, type RootId, type TrackId } from "./catalog";
import type { PlaybackState, RepeatMode } from "./player";

export interface SavedPlayback {
  version: 1;
  rootId: RootId;
  library: TrackId[];
  queue: TrackId[];
  edited: boolean;
  // Indexes into the saved queue distinguish occurrences of the same track.
  order: number[];
  current: number | null;
  position: number;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number | undefined;
}

export function capturePlayback(
  rootId: RootId,
  state: PlaybackState,
  edited: boolean,
): SavedPlayback {
  const indexes = new Map(state.queue.map((entry, index) => [entry.id, index]));
  return {
    version: 1,
    rootId,
    library: state.tracks.map((track) => trackId(rootId, track.path)),
    queue: state.queue.map((entry) => trackId(rootId, entry.track.path)),
    edited,
    order: state.order.map((id) => indexes.get(id)!),
    current: state.currentId === null ? null : (indexes.get(state.currentId) ?? null),
    position: state.currentTime,
    shuffle: state.shuffle,
    repeat: state.repeat,
    volume: state.volume,
  };
}

function trackIds(value: unknown): value is TrackId[] {
  return Array.isArray(value) && value.every((id: unknown) => typeof id === "string");
}

export function readSavedPlayback(value: unknown, rootId: RootId): SavedPlayback | undefined {
  if (!value || typeof value !== "object") return;
  const saved = value as Record<string, unknown>;
  if (
    saved.version !== 1 ||
    saved.rootId !== rootId ||
    !trackIds(saved.library) ||
    !trackIds(saved.queue) ||
    typeof saved.edited !== "boolean"
  ) {
    return;
  }
  const queue = saved.queue;
  const validIndex = (index: unknown): index is number =>
    typeof index === "number" && Number.isInteger(index) && index >= 0 && index < queue.length;
  const order =
    Array.isArray(saved.order) &&
    saved.order.length === queue.length &&
    saved.order.every(validIndex) &&
    new Set(saved.order).size === queue.length
      ? saved.order
      : queue.map((_, index) => index);
  return {
    version: 1,
    rootId,
    library: saved.library,
    queue,
    edited: saved.edited,
    order,
    current: validIndex(saved.current) ? saved.current : null,
    position:
      typeof saved.position === "number" && Number.isFinite(saved.position) && saved.position >= 0
        ? saved.position
        : 0,
    shuffle: saved.shuffle === true,
    repeat: saved.repeat === "all" || saved.repeat === "one" ? saved.repeat : "off",
    volume:
      typeof saved.volume === "number" && saved.volume >= 0 && saved.volume <= 1
        ? saved.volume
        : undefined,
  };
}
