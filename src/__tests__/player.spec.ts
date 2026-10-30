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
      expect([...handlers.keys()]).toEqual([
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "seekto",
        "seekbackward",
        "seekforward",
      ]);
      player.setTracks([track("one.mp3"), track("two.mp3")]);
      await player.playAt(0);
      expect(mediaSession.playbackState).toBe("playing");
      expect(mediaSession.metadata).toMatchObject({ init: { title: "one.mp3" } });
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

describe("queue refresh", () => {
  it("preserves playback, position and source as tracks are added, removed and reordered", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const a = track("a.mp3");
    const b = track("b.mp3");
    const c = track("c.mp3");
    player.setTracks([a, b]);
    await player.playAt(1);
    audio.currentTime = 17;
    const pause = vi.spyOn(audio, "pause").mockClear();
    const load = vi.spyOn(audio, "load").mockClear();
    player.updateTracks([c, a, track("b.mp3")]);
    expect(player.getState()).toMatchObject({ index: 2, playing: true });
    expect(audio.currentTime).toBe(17);
    player.updateTracks([track("b.mp3"), c]);
    expect(player.getState()).toMatchObject({ index: 0, playing: true });
    expect(audio.src).toBe("blob:track");
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    ended(audio);
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 1, playing: true }));
    player.dispose();
  });

  it("keeps a paused track and leaves an unselected queue unselected", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("a.mp3")]);
    player.updateTracks([track("a.mp3"), track("b.mp3")]);
    expect(player.getState().index).toBe(-1);
    await player.playAt(0);
    await player.toggle();
    audio.currentTime = 8;
    const load = vi.spyOn(audio, "load").mockClear();
    player.updateTracks([track("b.mp3"), track("a.mp3")]);
    expect(player.getState()).toMatchObject({ index: 1, playing: false });
    expect(audio.currentTime).toBe(8);
    expect(load).not.toHaveBeenCalled();
    await player.toggle();
    expect(player.getState().playing).toBe(true);
    player.dispose();
  });

  it("stops and clears the selection and Media Session metadata when the current track disappears", async () => {
    const mediaSession = { playbackState: "none", metadata: null, setActionHandler: vi.fn() };
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: mediaSession });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: MediaMetadataInit) {}
      },
    );
    try {
      const audio = audioElement();
      const player = createPlayer(audio);
      player.setTracks([track("a.mp3"), track("b.mp3")]);
      await player.playAt(0);
      player.updateTracks([track("b.mp3")]);
      expect(player.getState()).toMatchObject({ index: -1, playing: false });
      expect(mediaSession.metadata).toBeNull();
      expect(mediaSession.playbackState).toBe("paused");
      expect(revokeObjectURL).toHaveBeenCalledOnce();
      await player.toggle();
      expect(player.getState()).toMatchObject({ index: 0, playing: true });
      player.dispose();
    } finally {
      Reflect.deleteProperty(navigator, "mediaSession");
      vi.unstubAllGlobals();
    }
  });

  it("tracks a pending read across a reorder and skips from its new position on failure", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const slow = deferred<File>();
    const b = track("b.mp3");
    vi.spyOn(b.handle, "getFile").mockReturnValue(slow.promise);
    player.setTracks([track("a.mp3"), b, track("c.mp3")]);
    const pending = player.playAt(1);
    player.updateTracks([track("c.mp3"), track("b.mp3"), track("d.mp3"), track("a.mp3")]);
    slow.reject(new Error("read failed"));
    await pending;
    expect(player.getState()).toMatchObject({ index: 2, playing: true });
    expect(player.getState().tracks[2]?.name).toBe("d.mp3");
    player.dispose();
  });

  it("cancels an in-flight read when its track is removed", async () => {
    const player = createPlayer(audioElement());
    const slow = deferred<File>();
    const item = track("slow.mp3");
    vi.spyOn(item.handle, "getFile").mockReturnValue(slow.promise);
    player.setTracks([item]);
    const pending = player.playAt(0);
    player.updateTracks([track("other.mp3")]);
    slow.resolve(new File([], "slow.mp3"));
    await pending;
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(player.getState()).toMatchObject({ index: -1, playing: false });
    player.dispose();
  });
  it("clears a past playback error on refresh while playing but preserves a retry prompt", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("broken.mp3", true), track("good.mp3")]);
    await player.playAt(0);
    expect(player.getState().error).toContain("broken.mp3");
    player.updateTracks([track("good.mp3")]);
    expect(player.getState()).toMatchObject({ index: 0, playing: true, error: "" });
    player.dispose();

    const blockedAudio = audioElement();
    vi.spyOn(blockedAudio, "play").mockRejectedValueOnce(
      new DOMException("blocked", "NotAllowedError"),
    );
    const blocked = createPlayer(blockedAudio);
    blocked.setTracks([track("good.mp3")]);
    await blocked.playAt(0);
    blocked.updateTracks([track("good.mp3")]);
    expect(blocked.getState().error).toContain("再生ボタン");
    await blocked.toggle();
    expect(blocked.getState().playing).toBe(true);
    blocked.dispose();
  });
});

describe("explicit queue and controls", () => {
  it("keeps duplicate entries distinct and preserves playback on edits", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const a = track("a.mp3");
    player.setTracks([a, track("b.mp3")]);
    await player.playAt(0);
    const current = player.getState().currentId!;
    player.addTrack(a);
    const duplicate = player.getState().queue[2]!;
    expect(duplicate.id).not.toBe(current);
    player.moveQueue(2, 0);
    player.removeFromQueue(duplicate.id);
    expect(player.getState()).toMatchObject({ currentId: current, playing: true });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    player.removeFromQueue(current);
    expect(player.getState()).toMatchObject({ currentId: null, playing: false, index: -1 });
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    player.dispose();
  });

  it("shuffles around the current entry and restores edited queue order", async () => {
    const player = createPlayer(audioElement());
    player.setTracks([track("a"), track("b"), track("c")]);
    await player.playAt(1);
    const current = player.getState().currentId;
    player.setShuffle(true);
    expect(player.getState().order[0]).toBe(current);
    expect(new Set(player.getState().order).size).toBe(3);
    player.addTrack(track("d"));
    player.moveQueue(3, 0);
    player.setShuffle(false);
    expect(player.getState().order).toEqual(player.getState().queue.map((entry) => entry.id));
    expect(player.getState()).toMatchObject({ currentId: current, playing: true });
    player.dispose();
  });

  it("distinguishes repeat one at the end from explicit next and wraps all", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("a"), track("b")]);
    await player.playAt(0);
    player.setRepeat("one");
    ended(audio);
    await vi.waitFor(() => expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(2));
    expect(player.getState().index).toBe(0);
    player.next();
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 1, playing: true }));
    player.setRepeat("all");
    ended(audio);
    await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 0, playing: true }));
    player.setRepeat("off");
    await player.playAt(1);
    ended(audio);
    expect(player.getState().playing).toBe(false);
    player.dispose();
  });

  it("cancels a pending read when its queue entry is removed", async () => {
    const player = createPlayer(audioElement());
    const item = track("slow");
    const slow = deferred<File>();
    vi.spyOn(item.handle, "getFile").mockReturnValue(slow.promise);
    player.setTracks([item]);
    const pending = player.playAt(0);
    player.removeFromQueue(player.getState().currentId!);
    slow.resolve(new File([], "slow"));
    await pending;
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(player.getState().currentId).toBeNull();
    player.dispose();
  });

  it("clamps seeks and rejects invalid durations and values", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("a")]);
    await player.playAt(0);
    Object.defineProperty(audio, "duration", { configurable: true, value: Infinity });
    audio.dispatchEvent(new Event("durationchange"));
    player.seek(20);
    expect(player.getState().duration).toBeNull();
    expect(audio.currentTime).toBe(0);
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    player.seek(120);
    expect(audio.currentTime).toBe(100);
    player.seek(-5);
    expect(audio.currentTime).toBe(0);
    player.seek(NaN);
    expect(audio.currentTime).toBe(0);
    player.dispose();
  });

  it("visits each shuffled entry once before stopping and maintains a duplicate on refresh", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const a = track("dir/a.mp3");
    player.setTracks([a, track("other/a.mp3"), track("c.mp3")]);
    player.addTrack(a);
    await player.playAt(0);
    player.setShuffle(true);
    const expected = [...player.getState().order];
    const visited = [player.getState().currentId];
    for (let i = 1; i < expected.length; i++) {
      ended(audio);
      await vi.waitFor(() => expect(player.getState().currentId).toBe(expected[i]));
      await vi.waitFor(() => expect(player.getState().playing).toBe(true));
      visited.push(player.getState().currentId);
    }
    ended(audio);
    expect(player.getState().playing).toBe(false);
    expect(visited).toEqual(expected);
    player.updateTracks([track("dir/a.mp3"), track("other/a.mp3"), track("c.mp3")]);
    expect(
      player.getState().queue.filter((entry) => entry.track.path === "dir/a.mp3"),
    ).toHaveLength(2);
    player.dispose();
  });

  it("ignores seeks during a pending switch and removes position listeners on disposal", async () => {
    const audio = audioElement();
    const remove = vi.spyOn(audio, "removeEventListener");
    const player = createPlayer(audio);
    const slow = deferred<File>();
    const second = track("second");
    vi.spyOn(second.handle, "getFile").mockReturnValue(slow.promise);
    player.setTracks([track("first"), second]);
    await player.playAt(0);
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    const switching = player.playAt(1);
    player.seek(50);
    expect(audio.currentTime).toBe(0);
    slow.resolve(new File([], "second"));
    await switching;
    player.dispose();
    for (const event of ["timeupdate", "durationchange", "loadedmetadata", "seeking", "seeked"]) {
      expect(remove).toHaveBeenCalledWith(event, expect.any(Function));
    }
  });

  it("routes Media Session seeking and sends finite position state", async () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    const media = {
      playbackState: "none",
      metadata: null,
      setActionHandler: vi.fn((action: string, handler: MediaSessionActionHandler | null) =>
        handlers.set(action, handler),
      ),
      setPositionState: vi.fn(),
    };
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: media });
    try {
      const audio = audioElement();
      const player = createPlayer(audio);
      player.setTracks([track("a")]);
      await player.playAt(0);
      Object.defineProperty(audio, "duration", { configurable: true, value: 90 });
      audio.dispatchEvent(new Event("durationchange"));
      handlers.get("seekto")?.({ action: "seekto", seekTime: 40 });
      handlers.get("seekforward")?.({ action: "seekforward", seekOffset: 8 });
      handlers.get("seekbackward")?.({ action: "seekbackward", seekOffset: 3 });
      expect(audio.currentTime).toBe(45);
      expect(media.setPositionState).toHaveBeenLastCalledWith({
        duration: 90,
        position: 45,
        playbackRate: 1,
      });
      player.dispose();
      expect([...handlers.values()].every((handler) => handler === null)).toBe(true);
    } finally {
      Reflect.deleteProperty(navigator, "mediaSession");
    }
  });
});
