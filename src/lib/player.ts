import type { Track } from "./library";
import { diagnostics } from "./diagnostics";

export interface QueueEntry {
  readonly id: number;
  readonly track: Track;
}
export type RepeatMode = "off" | "all" | "one";
export interface PlaybackState {
  readonly tracks: Track[];
  /** Index in the library, retained for existing callers. */
  readonly index: number;
  readonly queue: QueueEntry[];
  readonly order: number[];
  readonly currentId: number | null;
  readonly playing: boolean;
  readonly error: string;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  readonly currentTime: number;
  readonly duration: number | null;
  readonly seeking: boolean;
  readonly volume: number;
}
type PlaybackListener = (state: PlaybackState) => void;

export function createPlayer(audio: HTMLAudioElement = new Audio()) {
  let state: PlaybackState = {
    tracks: [],
    index: -1,
    queue: [],
    order: [],
    currentId: null,
    playing: false,
    error: "",
    shuffle: false,
    repeat: "off",
    currentTime: 0,
    duration: null,
    seeking: false,
    volume: audio.volume,
  };
  const listeners = new Set<PlaybackListener>();
  let nextId = 0;
  let objectUrl: string | undefined;
  let generation = 0;
  let pending = false;
  let disposed = false;
  let edited = false;
  const currentEntry = () => state.queue.find((entry) => entry.id === state.currentId);
  const currentTrack = () => currentEntry()?.track;
  const log = (event: Parameters<typeof diagnostics.record>[0], cause?: unknown) => {
    if (diagnostics.isEnabled()) diagnostics.record(event, audio, currentTrack(), cause);
  };
  function syncMedia(): void {
    if (!("mediaSession" in navigator)) return;
    const media = navigator.mediaSession;
    media.playbackState = state.playing ? "playing" : "paused";
    const track = currentTrack();
    if (track && typeof MediaMetadata !== "undefined")
      media.metadata = new MediaMetadata({ title: track.name, artist: "offtone" });
    else if (!track) media.metadata = null;
    if (typeof media.setPositionState === "function") {
      try {
        if (state.duration !== null)
          media.setPositionState({
            duration: state.duration,
            position: Math.min(state.duration, state.currentTime),
            playbackRate:
              Number.isFinite(audio.playbackRate) && audio.playbackRate > 0
                ? audio.playbackRate
                : 1,
          });
        else media.setPositionState();
      } catch {
        /* Some browsers do not implement position state fully. */
      }
    }
  }
  function update(changes: Partial<PlaybackState>): void {
    state = { ...state, ...changes };
    syncMedia();
    for (const listener of listeners) listener(state);
  }
  function releaseUrl(): void {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  }
  function clearSource(): void {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    releaseUrl();
  }
  function libraryIndex(id: number | null, queue = state.queue, tracks = state.tracks): number {
    const entry = queue.find((item) => item.id === id);
    return entry ? tracks.findIndex((track) => track.path === entry.track.path) : -1;
  }
  function shuffled(ids: number[]): number[] {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  }
  function makeEntry(track: Track): QueueEntry {
    return { id: ++nextId, track };
  }
  function setTracks(tracks: Track[]): void {
    generation++;
    pending = false;
    clearSource();
    edited = false;
    const queue = tracks.map(makeEntry);
    update({
      tracks,
      queue,
      order: state.shuffle ? shuffled(queue.map((e) => e.id)) : queue.map((e) => e.id),
      currentId: null,
      index: -1,
      playing: false,
      error: "",
      currentTime: 0,
      duration: null,
      seeking: false,
    });
  }
  function updateTracks(tracks: Track[]): void {
    const current = currentTrack();
    if (current && !tracks.some((track) => track.path === current.path)) {
      setTracks(tracks);
      return;
    }
    const oldPaths = new Set(state.tracks.map((track) => track.path));
    const byPath = new Map(tracks.map((track) => [track.path, track]));
    let queue: QueueEntry[];
    if (edited) {
      queue = state.queue.flatMap((entry) => {
        const track = byPath.get(entry.track.path);
        return track ? [{ ...entry, track }] : [];
      });
      queue.push(...tracks.filter((track) => !oldPaths.has(track.path)).map(makeEntry));
    } else {
      queue = tracks.map((track) => {
        const existing = state.queue.find((entry) => entry.track.path === track.path);
        return existing ? { ...existing, track } : makeEntry(track);
      });
    }
    const ids = new Set(queue.map((entry) => entry.id));
    let order = state.shuffle
      ? state.order.filter((id) => ids.has(id))
      : queue.map((entry) => entry.id);
    if (state.shuffle)
      order = [
        ...order,
        ...shuffled(queue.map((entry) => entry.id).filter((id) => !order.includes(id))),
      ];
    update({
      tracks,
      queue,
      order,
      index: libraryIndex(state.currentId, queue, tracks),
      error: state.playing ? "" : state.error,
    });
  }
  function setShuffle(shuffle: boolean): void {
    if (shuffle === state.shuffle) return;
    const ids = state.queue.map((entry) => entry.id);
    const order = shuffle
      ? state.currentId === null
        ? shuffled(ids)
        : [state.currentId, ...shuffled(ids.filter((id) => id !== state.currentId))]
      : ids;
    update({ shuffle, order });
  }
  function setRepeat(repeat: RepeatMode): void {
    update({ repeat });
  }
  function addTrack(track: Track): void {
    edited = true;
    const entry = makeEntry(track);
    update({ queue: [...state.queue, entry], order: [...state.order, entry.id] });
  }
  function removeFromQueue(id: number): void {
    if (!state.queue.some((entry) => entry.id === id)) return;
    edited = true;
    const queue = state.queue.filter((entry) => entry.id !== id);
    const order = state.order.filter((item) => item !== id);
    if (state.currentId === id) {
      generation++;
      pending = false;
      clearSource();
      update({
        queue,
        order,
        currentId: null,
        index: -1,
        playing: false,
        error: "",
        currentTime: 0,
        duration: null,
        seeking: false,
      });
    } else update({ queue, order });
  }
  function moveQueue(from: number, to: number): void {
    if (from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length || from === to)
      return;
    edited = true;
    const queue = [...state.queue];
    const [entry] = queue.splice(from, 1);
    queue.splice(to, 0, entry!);
    update({ queue, order: state.shuffle ? state.order : queue.map((item) => item.id) });
  }
  async function playId(id: number): Promise<void> {
    if (disposed || !state.queue.some((entry) => entry.id === id)) return;
    log("play-request");
    const run = ++generation;
    pending = true;
    clearSource();
    update({ playing: false, currentTime: 0, duration: null, seeking: false });
    const attempted = new Set<number>();
    let candidate: number | undefined = id;
    while (candidate !== undefined && !attempted.has(candidate)) {
      const entry = state.queue.find((item) => item.id === candidate);
      if (!entry || run !== generation) return;
      attempted.add(candidate);
      update({ currentId: candidate, index: libraryIndex(candidate) });
      log("track-switch");
      if (run !== generation) return;
      let reading = true;
      try {
        const file = await entry.track.handle.getFile();
        reading = false;
        if (run !== generation) return;
        objectUrl = URL.createObjectURL(file);
        audio.src = objectUrl;
        await audio.play();
        if (run !== generation) return;
        pending = false;
        updatePosition();
        return;
      } catch (cause) {
        if (run !== generation) return;
        log(reading ? "read-failure" : "play-failure", cause);
        if (objectUrl && cause instanceof DOMException && cause.name === "NotAllowedError") {
          pending = false;
          update({
            playing: false,
            error: "再生を開始できませんでした。再生ボタンを押してください。",
          });
          return;
        }
        clearSource();
        update({ playing: false, error: `「${entry.track.name}」を再生できませんでした。` });
        const position = state.order.indexOf(candidate);
        candidate = state.order[position + 1];
      }
    }
    if (run === generation) {
      pending = false;
      update({ playing: false });
    }
  }
  async function playAt(target: number): Promise<void> {
    const track = state.tracks[target];
    if (!track) return;
    let entry = state.queue.find((item) => item.track.path === track.path);
    if (!entry) {
      addTrack(track);
      entry = state.queue[state.queue.length - 1];
    }
    if (entry) await playId(entry.id);
  }
  function pause(): void {
    if (pending) {
      generation++;
      pending = false;
      clearSource();
      update({ playing: false, currentTime: 0, duration: null, seeking: false });
    } else audio.pause();
  }
  async function toggle(): Promise<void> {
    if (disposed) return;
    if (state.playing || pending) pause();
    else if (state.currentId === null || !audio.src) {
      const id = state.currentId ?? state.order[0];
      if (id !== undefined && id !== null) await playId(id);
    } else {
      log("play-request");
      const run = ++generation;
      pending = true;
      try {
        await audio.play();
        if (run === generation) pending = false;
      } catch (cause) {
        if (run !== generation) return;
        log("play-failure", cause);
        pending = false;
        update({ playing: false, error: "再生を開始できませんでした。もう一度お試しください。" });
      }
    }
  }
  function previous(): void {
    const pos = state.order.indexOf(state.currentId ?? -1);
    if (pos > 0) void playId(state.order[pos - 1]!);
  }
  function advance(automatic = false): void {
    if (state.currentId === null) return;
    if (automatic && state.repeat === "one") {
      void playId(state.currentId);
      return;
    }
    const pos = state.order.indexOf(state.currentId);
    const id = state.order[pos + 1] ?? (state.repeat === "all" ? state.order[0] : undefined);
    if (id !== undefined) void playId(id);
    else if (automatic) update({ playing: false });
  }
  function next(): void {
    advance();
  }
  function seek(seconds: number): void {
    if (
      !objectUrl ||
      pending ||
      audio.error ||
      state.duration === null ||
      !Number.isFinite(seconds)
    )
      return;
    try {
      audio.currentTime = Math.max(0, Math.min(state.duration, seconds));
      updatePosition();
      log("seek");
    } catch {
      /* The resource may no longer be seekable. */
    }
  }
  function setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    audio.volume = Math.max(0, Math.min(1, volume));
    update({ volume: audio.volume });
  }
  function updatePosition(): void {
    if (!objectUrl || pending || audio.error) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
    const currentTime = Number.isFinite(audio.currentTime)
      ? Math.max(0, duration === null ? audio.currentTime : Math.min(duration, audio.currentTime))
      : 0;
    if (
      duration !== state.duration ||
      currentTime !== state.currentTime ||
      audio.seeking !== state.seeking
    )
      update({ duration, currentTime, seeking: audio.seeking });
  }
  function onPlay(): void {
    if (objectUrl && !audio.paused) update({ playing: true });
  }
  function onPause(): void {
    if (audio.paused) update({ playing: false });
  }
  function onEnded(): void {
    if (objectUrl && !pending && audio.ended) advance(true);
  }
  function onError(): void {
    const track = currentTrack();
    if (!track || !objectUrl || !audio.error) return;
    generation++;
    pending = false;
    clearSource();
    update({
      playing: false,
      error: `「${track.name}」を再生できませんでした。`,
      currentTime: 0,
      duration: null,
      seeking: false,
    });
    // Error recovery never repeats a broken file.
    const pos = state.order.indexOf(state.currentId ?? -1);
    const id = state.order[pos + 1];
    if (id !== undefined) void playId(id);
  }
  const diagnosticEvents = [
    "play",
    "pause",
    "ended",
    "error",
    "waiting",
    "stalled",
    "suspend",
    "canplay",
  ] as const;
  const onDiagnosticEvent = (event: Event) => log(event.type as (typeof diagnosticEvents)[number]);
  const onVisibility = () => {
    log("visibilitychange");
    updatePosition();
  };
  for (const event of diagnosticEvents) audio.addEventListener(event, onDiagnosticEvent);
  document.addEventListener("visibilitychange", onVisibility);
  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);
  const positionEvents = [
    "timeupdate",
    "durationchange",
    "loadedmetadata",
    "seeking",
    "seeked",
  ] as const;
  for (const event of positionEvents) audio.addEventListener(event, updatePosition);
  const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    [
      "play",
      () => {
        log("media-play");
        if (!state.playing && !pending) void toggle();
      },
    ],
    [
      "pause",
      () => {
        log("media-pause");
        pause();
      },
    ],
    [
      "previoustrack",
      () => {
        log("media-previoustrack");
        previous();
      },
    ],
    [
      "nexttrack",
      () => {
        log("media-nexttrack");
        next();
      },
    ],
    [
      "seekto",
      (details) => {
        log("media-seekto");
        if (details.seekTime !== undefined) seek(details.seekTime);
      },
    ],
    [
      "seekbackward",
      (details) => {
        log("media-seekbackward");
        seek(audio.currentTime - (details.seekOffset ?? 10));
      },
    ],
    [
      "seekforward",
      (details) => {
        log("media-seekforward");
        seek(audio.currentTime + (details.seekOffset ?? 10));
      },
    ],
  ];
  if ("mediaSession" in navigator)
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* unsupported */
      }
    }
  function dispose(): void {
    generation++;
    disposed = true;
    pending = false;
    clearSource();
    for (const event of diagnosticEvents) audio.removeEventListener(event, onDiagnosticEvent);
    for (const event of positionEvents) audio.removeEventListener(event, updatePosition);
    document.removeEventListener("visibilitychange", onVisibility);
    audio.removeEventListener("play", onPlay);
    audio.removeEventListener("pause", onPause);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    listeners.clear();
    if ("mediaSession" in navigator)
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* unsupported */
        }
      }
  }
  return {
    getState: () => state,
    subscribe(listener: PlaybackListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTracks,
    updateTracks,
    playAt,
    playId,
    toggle,
    previous,
    next,
    setShuffle,
    setRepeat,
    addTrack,
    removeFromQueue,
    moveQueue,
    seek,
    setVolume,
    dispose,
  };
}
