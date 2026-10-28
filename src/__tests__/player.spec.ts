import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPlayer } from "../lib/player";
import type { Track } from "../lib/library";

function track(name: string, fail = false): Track {
  return {
    name,
    path: name,
    handle: {
      getFile: fail
        ? vi.fn().mockRejectedValue(new Error("unreadable"))
        : vi.fn().mockResolvedValue(new File(["audio"], name)),
    } as unknown as FileSystemFileHandle,
  };
}

function audioElement(): HTMLAudioElement {
  const audio = document.createElement("audio");
  let paused = true;
  Object.defineProperty(audio, "paused", { get: () => paused });
  audio.play = vi.fn().mockImplementation(async () => {
    paused = false;
    audio.dispatchEvent(new Event("play"));
  });
  audio.pause = vi.fn().mockImplementation(() => {
    paused = true;
    audio.dispatchEvent(new Event("pause"));
  });
  audio.load = vi.fn();
  return audio;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function ended(audio: HTMLAudioElement): void {
  Object.defineProperty(audio, "ended", { configurable: true, value: true });
  audio.dispatchEvent(new Event("ended"));
  Object.defineProperty(audio, "ended", { configurable: true, value: false });
}

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue("blob:track");
  revokeObjectURL.mockReset();
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

describe("player", () => {
  it("skips unreadable tracks and plays the next one", async () => {
    const player = createPlayer(audioElement());
    player.setTracks([track("broken.mp3", true), track("good.mp3")]);
    await player.playAt(0);
    expect(player.getState().index).toBe(1);
    expect(player.getState().playing).toBe(true);
    expect(player.getState().error).toContain("broken.mp3");
  });

  it("再生状態の購読を解除できる", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const listener = vi.fn();
    const unsubscribe = player.subscribe(listener);
    player.setTracks([track("one.mp3")]);
    await player.playAt(0);
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ index: 0, playing: true }));
    unsubscribe();
    listener.mockClear();
    audio.pause();
    expect(listener).not.toHaveBeenCalled();
    player.dispose();
  });

  it("advances after a song ends and stops at the end of the queue", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const play = vi.spyOn(audio, "play");
    player.setTracks([track("one.mp3"), track("two.mp3")]);
    await player.playAt(0);
    ended(audio);
    await vi.waitFor(() => expect(player.getState().index).toBe(1));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    ended(audio);
    expect(player.getState().index).toBe(1);
    expect(player.getState().playing).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("stops the old source during a delayed switch and ignores an older file result", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const slow = deferred<File>();
    const second = track("second.mp3");
    vi.spyOn(second.handle, "getFile").mockReturnValue(slow.promise);
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:third");
    player.setTracks([track("first.mp3"), second, track("third.mp3")]);
    await player.playAt(0);
    const old = player.playAt(1);
    expect(audio.hasAttribute("src")).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    await player.playAt(2);
    slow.resolve(new File([], "second.mp3"));
    await old;
    expect(player.getState()).toMatchObject({ index: 2, playing: true });
    expect(audio.src).toBe("blob:third");
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:third");
  });

  it("ignores a stale play rejection after a newer track starts", async () => {
    const audio = audioElement();
    const firstPlay = deferred<void>();
    const play = vi.spyOn(audio, "play");
    const normalPlay = play.getMockImplementation()!;
    play.mockImplementationOnce(() => firstPlay.promise).mockImplementation(normalPlay);
    createObjectURL.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const player = createPlayer(audio);
    player.setTracks([track("first.mp3"), track("second.mp3")]);
    const old = player.playAt(0);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    await player.playAt(1);
    firstPlay.reject(new Error("old failure"));
    await old;
    expect(player.getState()).toMatchObject({ index: 1, playing: true, error: "" });
    expect(audio.src).toBe("blob:second");
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending file read on toggle, queue replacement, and disposal", async () => {
    for (const cancel of ["toggle", "setTracks", "dispose"] as const) {
      const audio = audioElement();
      const player = createPlayer(audio);
      const slow = deferred<File>();
      const item = track("slow.mp3");
      vi.spyOn(item.handle, "getFile").mockReturnValue(slow.promise);
      player.setTracks([item]);
      const request = player.playAt(0);
      if (cancel === "toggle") await player.toggle();
      if (cancel === "setTracks") player.setTracks([]);
      if (cancel === "dispose") player.dispose();
      createObjectURL.mockClear();
      slow.resolve(new File([], "slow.mp3"));
      await request;
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(vi.spyOn(audio, "play")).not.toHaveBeenCalled();
      expect(player.getState().playing).toBe(false);
      if (cancel !== "dispose") player.dispose();
    }
  });

  it("retains the source on autoplay rejection so it can be retried", async () => {
    const audio = audioElement();
    vi.spyOn(audio, "play").mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    const player = createPlayer(audio);
    player.setTracks([track("one.mp3"), track("two.mp3")]);
    await player.playAt(0);
    expect(player.getState()).toMatchObject({ index: 0, playing: false });
    expect(player.getState().error).toContain("再生ボタン");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await player.toggle();
    expect(player.getState()).toMatchObject({ index: 0, playing: true });
    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("ignores obsolete ended and error events, and advances once for a current error", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("one.mp3"), track("two.mp3"), track("three.mp3")]);
    await player.playAt(0);
    await player.playAt(1);
    audio.dispatchEvent(new Event("ended"));
    audio.dispatchEvent(new Event("error"));
    expect(player.getState()).toMatchObject({ index: 1, playing: true, error: "" });
    Object.defineProperty(audio, "error", { configurable: true, value: { code: 3 } });
    audio.dispatchEvent(new Event("error"));
    Object.defineProperty(audio, "error", { configurable: true, value: null });
    audio.dispatchEvent(new Event("error"));
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 2, playing: true }));
    expect(player.getState().error).toContain("two.mp3");
    player.dispose();
  });

  it("handles an error while play is pending only once, even when the old play rejects", async () => {
    const audio = audioElement();
    const firstPlay = deferred<void>();
    vi.spyOn(audio, "play").mockImplementationOnce(() => firstPlay.promise);
    const player = createPlayer(audio);
    player.setTracks([track("broken.mp3"), track("good.mp3")]);
    const old = player.playAt(0);
    await vi.waitFor(() => expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(1));
    Object.defineProperty(audio, "error", { configurable: true, value: { code: 3 } });
    audio.dispatchEvent(new Event("error"));
    Object.defineProperty(audio, "error", { configurable: true, value: null });
    firstPlay.reject(new Error("broken file"));
    await old;
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 1, playing: true }));
    expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("keeps Media Session actions and playback state in sync", async () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    const mediaSession = {
      playbackState: "none",
      metadata: null,
      setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) => {
        handlers.set(action, handler);
      }),
    };
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: MediaMetadataInit) {}
      },
    );
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
    try {
      const player = createPlayer(audioElement());
      player.setTracks([track("one.mp3"), track("two.mp3")]);
      await player.playAt(0);
      expect(mediaSession.playbackState).toBe("playing");
      handlers.get("nexttrack")?.({ action: "nexttrack" });
      await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 1, playing: true }));
      handlers.get("pause")?.({ action: "pause" });
      expect(mediaSession.playbackState).toBe("paused");
      handlers.get("play")?.({ action: "play" });
      await vi.waitFor(() => expect(mediaSession.playbackState).toBe("playing"));
      player.dispose();
      expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, "mediaSession");
      vi.unstubAllGlobals();
    }
  });

  it("ignores a stale successful play after cancellation and a new selection", async () => {
    const audio = audioElement();
    const firstPlay = deferred<void>();
    vi.spyOn(audio, "play").mockImplementationOnce(() => firstPlay.promise);
    const player = createPlayer(audio);
    player.setTracks([track("one.mp3"), track("two.mp3")]);
    const old = player.playAt(0);
    await vi.waitFor(() => expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(1));
    await player.toggle();
    await player.playAt(1);
    firstPlay.resolve();
    await old;
    expect(player.getState()).toMatchObject({ index: 1, playing: true, error: "" });
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    player.dispose();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
