import type { Track } from "./library";

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

  function syncMedia(): void {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = state.playing ? "playing" : "paused";
    const track = state.tracks[state.index];
    if (track && typeof MediaMetadata !== "undefined") {
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.name, artist: "offtone" });
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
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    releaseUrl();
    update({ tracks, index: -1, playing: false, error: "" });
  }

  /** 指定した曲を再生し、読み取れない曲や未対応の曲を飛ばす。 */
  async function playAt(target: number): Promise<void> {
    if (target < 0 || target >= state.tracks.length) return;
    const run = ++generation;
    pending = false;
    audio.pause();
    releaseUrl();

    for (let nextIndex = target; nextIndex < state.tracks.length; nextIndex++) {
      const track = state.tracks[nextIndex];
      if (!track || run !== generation) return;
      update({ index: nextIndex });
      try {
        const file = await track.handle.getFile();
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
        pending = false;
        if (cause instanceof DOMException && cause.name === "NotAllowedError") {
          update({ error: "再生を開始できませんでした。再生ボタンを押してください。" });
          return;
        }
        releaseUrl();
        audio.removeAttribute("src");
        update({ error: `「${track.name}」を再生できませんでした。` });
      }
    }
    update({ playing: false });
  }

  /** 再生と一時停止を切り替え、曲が未選択なら先頭から再生する。 */
  async function toggle(): Promise<void> {
    if (state.playing) {
      audio.pause();
    } else if (state.index < 0 || !audio.src) {
      await playAt(Math.max(state.index, 0));
    } else {
      try {
        await audio.play();
      } catch {
        update({ error: "再生を開始できませんでした。もう一度お試しください。" });
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
    update({ playing: true });
  }

  function onPause(): void {
    update({ playing: false });
  }

  function onEnded(): void {
    if (state.index + 1 < state.tracks.length) {
      next();
    } else {
      update({ playing: false });
    }
  }

  function onError(): void {
    const track = state.tracks[state.index];
    if (track && audio.src && !pending) {
      update({ error: `「${track.name}」を再生できませんでした。` });
      next();
    }
  }

  audio.addEventListener("play", onPlay);
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", onError);

  const actions: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
    [
      "play",
      () => {
        if (!state.playing) void toggle();
      },
    ],
    ["pause", () => audio.pause()],
    ["previoustrack", previous],
    ["nexttrack", next],
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
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    releaseUrl();
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

  return { getState, subscribe, setTracks, playAt, toggle, previous, next, dispose };
}
