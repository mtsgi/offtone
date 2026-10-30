import type { Track } from "./library";
import { diagnostics } from "./diagnostics";

/** 再生サービスが公開する現在の状態。 */
export interface PlaybackState {
  readonly tracks: Track[];
  readonly index: number;
  readonly playing: boolean;
  readonly error: string;
}

type PlaybackListener = (state: PlaybackState) => void;

/** 音声要素を管理し、再生状態とシステムのメディア操作を同期する。 */
export function createPlayer(audio: HTMLAudioElement = new Audio()) {
  let state: PlaybackState = { tracks: [], index: -1, playing: false, error: "" };
  const listeners = new Set<PlaybackListener>();
  let objectUrl: string | undefined;
  let generation = 0;
  let pending = false;
  let disposed = false;

  const currentTrack = () => state.tracks[state.index];
  const log = (event: Parameters<typeof diagnostics.record>[0], cause?: unknown) => {
    if (diagnostics.isEnabled()) diagnostics.record(event, audio, currentTrack(), cause);
  };

  function syncMedia(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    const track = state.tracks[state.index];
    if (track && typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.name, artist: "offtone" });
    } else if (!track) {
      navigator.mediaSession.metadata = null;
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

  /** 現在の再生状態を取得する。 */
  function getState(): PlaybackState {
    return state;
  }

  /** 再生状態の変更を購読し、購読解除関数を返す。 */
  function subscribe(listener: PlaybackListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /** 再生中の曲を停止し、再生キューを置き換える。 */
  function setTracks(tracks: Track[]): void {
    generation++;
    pending = false;
    clearSource();
    update({ tracks, index: -1, playing: false, error: "" });
  }

  /** 同じフォルダーの更新を、現在の音源を維持して反映する。 */
  function updateTracks(tracks: Track[]): void {
    const current = state.tracks[state.index];
    const index = current ? tracks.findIndex((track) => track.path === current.path) : -1;
    if (current && index < 0) {
      setTracks(tracks);
      return;
    }
    // 再生中に残った過去のエラーは更新時に解除する。停止中の再試行案内は保持する。
    update({ tracks, index, error: state.playing ? "" : state.error });
  }

  /** 指定した曲を再生し、読み取れない曲や未対応の曲を飛ばす。 */
  async function playAt(target: number): Promise<void> {
    if (disposed || target < 0 || target >= state.tracks.length) return;
    log("play-request");
    const run = ++generation;
    pending = true;
    clearSource();
    update({ playing: false });

    for (let nextIndex = target; nextIndex < state.tracks.length; nextIndex++) {
      const track = state.tracks[nextIndex];
      if (!track || run !== generation) return;
      update({ index: nextIndex });
      log("track-switch");
      if (run !== generation) return;
      let reading = true;
      try {
        const file = await track.handle.getFile();
        reading = false;
        if (run !== generation) return;
        objectUrl = URL.createObjectURL(file);
        pending = true;
        audio.src = objectUrl;
        await audio.play();
        if (run !== generation) return;
        pending = false;
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
        update({ playing: false, error: `「${track.name}」を再生できませんでした。` });
        // 読み取り待ちの間にキューが並び替わっていても現在曲の次から進む。
        nextIndex = state.index;
      }
    }
    if (run === generation) {
      pending = false;
      update({ playing: false });
    }
  }

  function pause(): void {
    if (pending) {
      generation++;
      pending = false;
      clearSource();
      update({ playing: false });
    } else {
      audio.pause();
    }
  }

  /** 再生と一時停止を切り替え、曲が未選択なら先頭から再生する。 */
  async function toggle(): Promise<void> {
    if (disposed) return;
    if (state.playing || pending) {
      pause();
    } else if (state.index < 0 || !audio.src) {
      await playAt(Math.max(state.index, 0));
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
    if (state.index > 0) void playAt(state.index - 1);
  }

  function next(): void {
    if (state.index + 1 < state.tracks.length) void playAt(state.index + 1);
  }

  function onPlay(): void {
    if (objectUrl && !audio.paused) update({ playing: true });
  }

  function onPause(): void {
    if (audio.paused) update({ playing: false });
  }

  function onEnded(): void {
    if (!objectUrl || pending || !audio.ended) return;
    if (state.index + 1 < state.tracks.length) {
      next();
    } else {
      update({ playing: false });
    }
  }

  function onError(): void {
    const track = state.tracks[state.index];
    if (!track || !objectUrl || !audio.error) return;
    generation++;
    pending = false;
    clearSource();
    update({ playing: false, error: `「${track.name}」を再生できませんでした。` });
    next();
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
  const onDiagnosticEvent = (event: Event) => {
    log(event.type as (typeof diagnosticEvents)[number]);
  };
  const onVisibility = () => log("visibilitychange");
  for (const event of diagnosticEvents) audio.addEventListener(event, onDiagnosticEvent);
  document.addEventListener("visibilitychange", onVisibility);

  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

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
  ];
  if ("mediaSession" in navigator) {
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        /* 未対応の操作は登録しない。 */
      }
    }
  }

  /** 音声要素の購読とメディア操作を解除し、使用中の URL を解放する。 */
  function dispose(): void {
    generation++;
    disposed = true;
    pending = false;
    clearSource();
    for (const event of diagnosticEvents) audio.removeEventListener(event, onDiagnosticEvent);
    document.removeEventListener("visibilitychange", onVisibility);
    audio.removeEventListener("play", onPlay);
    audio.removeEventListener("pause", onPause);
    audio.removeEventListener("ended", onEnded);
    audio.removeEventListener("error", onError);
    listeners.clear();
    if ("mediaSession" in navigator) {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          /* 未対応の操作は解除しない。 */
        }
      }
    }
  }

  return { getState, subscribe, setTracks, updateTracks, playAt, toggle, previous, next, dispose };
}
