import type { Track } from "./library";

type EventName =
  | "play"
  | "pause"
  | "ended"
  | "error"
  | "waiting"
  | "stalled"
  | "suspend"
  | "canplay"
  | "visibilitychange"
  | "play-request"
  | "track-switch"
  | "read-failure"
  | "play-failure"
  | "media-play"
  | "media-pause"
  | "media-previoustrack"
  | "media-nexttrack"
  | "seek"
  | "media-seekto"
  | "media-seekbackward"
  | "media-seekforward"
  | "marker";

type ErrorName =
  | "NotAllowedError"
  | "NotFoundError"
  | "NotReadableError"
  | "AbortError"
  | "SecurityError"
  | "NotSupportedError"
  | "other";

interface Entry {
  time: string;
  event: EventName;
  track?: number;
  currentTime?: number | null;
  duration?: number | null;
  readyState?: number;
  networkState?: number;
  mediaErrorCode?: number;
  errorName?: ErrorName;
  visibility?: DocumentVisibilityState;
}

const LIMIT = 500;
const safeErrors = new Set([
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "AbortError",
  "SecurityError",
  "NotSupportedError",
]);

/** メモリ内だけに、許可した項目を固定件数保持する。 */
export function createDiagnostics(limit = LIMIT) {
  let enabled = false;
  let entries: Entry[] = [];
  let next = 0;
  let ids = new WeakMap<FileSystemFileHandle, number>();
  let nextId = 1;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  function record(
    event: EventName,
    audio?: HTMLAudioElement,
    track?: Track,
    cause?: unknown,
  ): void {
    if (!enabled) return;
    const entry: Entry = { time: new Date().toISOString(), event };
    if (track) {
      let id = ids.get(track.handle);
      if (!id) {
        id = nextId++;
        ids.set(track.handle, id);
      }
      entry.track = id;
    }
    if (audio) {
      entry.currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : null;
      entry.duration = Number.isFinite(audio.duration) ? audio.duration : null;
      entry.readyState = audio.readyState;
      entry.networkState = audio.networkState;
      if (audio.error) entry.mediaErrorCode = audio.error.code;
    }
    if (cause !== undefined) {
      const name = cause instanceof Error || cause instanceof DOMException ? cause.name : "other";
      entry.errorName = safeErrors.has(name) ? (name as ErrorName) : "other";
    }
    if (typeof document !== "undefined") entry.visibility = document.visibilityState;
    if (entries.length < limit) entries.push(entry);
    else {
      entries[next] = entry;
      next = (next + 1) % limit;
    }
    notify();
  }
  function snapshot(): Entry[] {
    return entries.length === limit
      ? [...entries.slice(next), ...entries.slice(0, next)]
      : [...entries];
  }
  function clear(): void {
    entries = [];
    next = 0;
    ids = new WeakMap();
    nextId = 1;
    notify();
  }
  function setEnabled(value: boolean): void {
    enabled = value;
    notify();
  }
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  return { record, snapshot, clear, setEnabled, isEnabled: () => enabled, subscribe };
}

export const diagnostics = createDiagnostics();
