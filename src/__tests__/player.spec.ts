import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPlayer } from "../lib/player";
import type { Track } from "../lib/library";
import { readSavedPlayback } from "../lib/playback-session";

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

describe("album playback", () => {
  it("publishes each replacement with its starting track and ignores a superseded file read", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    const a = track("a.mp3");
    const b = track("b.mp3");
    const c = track("c.mp3");
    const read = deferred<File>();
    vi.spyOn(b.handle, "getFile").mockReturnValueOnce(read.promise);
    const play = vi.spyOn(audio, "play");
    player.setTracks([a, b, c]);
    player.setShuffle(true);
    player.setRepeat("one");
    const published = vi.fn();
    player.subscribe(published);

    const pending = player.playAlbum([b, a]);
    expect(published).toHaveBeenCalledTimes(1);
    const first = player.getState();
    expect(first.currentId).toBe(first.queue[0]?.id);
    expect(first.queue.map(({ track }) => track)).toEqual([b, a]);
    expect(first.order).toEqual(first.queue.map(({ id }) => id));
    expect(first.shuffle).toBe(false);
    expect(first.repeat).toBe("off");
    expect(player.capturePlayback("root")).toMatchObject({ edited: true, repeat: "off" });

    await player.playAlbum([c]);
    read.resolve(new File(["audio"], b.name));
    await pending;
    const latest = player.getState();
    expect(latest.queue.map(({ track }) => track)).toEqual([c]);
    expect(latest.currentId).toBe(latest.queue[0]?.id);
    expect(latest.playing).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    player.dispose();
  });

  it.each(["one", "all"] as const)(
    "plays the next album track and handles the end of the album with repeat %s",
    async (repeat) => {
      const audio = audioElement();
      const player = createPlayer(audio);
      const first = track("first.mp3");
      const last = track("last.mp3");
      player.setTracks([last, first]);
      player.setRepeat(repeat);
      await player.playAlbum([first, last]);
      expect(player.getState()).toMatchObject({
        index: 1,
        repeat: repeat === "one" ? "off" : "all",
      });

      ended(audio);
      await vi.waitFor(() => expect(player.getState()).toMatchObject({ index: 0, playing: true }));
      ended(audio);
      if (repeat === "all") {
        await vi.waitFor(() =>
          expect(player.getState()).toMatchObject({ index: 1, playing: true }),
        );
      } else {
        expect(player.getState()).toMatchObject({ index: 0, playing: false });
      }
      player.dispose();
    },
  );

  it("discards album selections whose tracks are no longer in the current library", async () => {
    const player = createPlayer(audioElement());
    const stale = track("same-path.mp3");
    const read = vi.spyOn(stale.handle, "getFile");
    player.setTracks([stale]);
    player.setTracks([track(stale.path)]);
    const before = player.getState();
    await player.playAlbum([stale]);
    expect(player.getState()).toBe(before);
    expect(read).not.toHaveBeenCalled();
    player.dispose();
  });
});

describe("playback restoration", () => {
  it.each([false, true])(
    "uses library order for an unedited queue with shuffle %s",
    async (shuffle) => {
      const player = createPlayer(audioElement());
      const b = track("b.mp3");
      const d = track("d.mp3");
      const removed = track("e.mp3");
      const previousTracks = [b, d, removed];
      player.setTracks(previousTracks);
      await player.playAt(1);
      player.setShuffle(shuffle);
      const saved = player.capturePlayback("root");

      const tracks = [track("a.mp3"), b, track("c.mp3"), d];
      player.setTracks(tracks);
      player.restorePlayback(readSavedPlayback(saved, "root")!);

      const restored = player.getState();
      expect(restored.queue.map((entry) => entry.track)).toEqual(tracks);
      expect(restored).toMatchObject({
        index: 3,
        currentId: restored.queue[3]!.id,
        playing: false,
      });
      if (shuffle) {
        const retained = saved.order
          .map((index) => previousTracks[index])
          .filter((track) => track !== removed);
        const playbackOrder = restored.order.map(
          (id) => restored.queue.find((entry) => entry.id === id)?.track,
        );
        expect(playbackOrder.slice(0, 2)).toEqual(retained);
        expect(new Set(playbackOrder.slice(2))).toEqual(new Set([tracks[0], tracks[2]]));
      }
      player.setShuffle(false);
      expect(player.getState().order).toEqual(restored.queue.map((entry) => entry.id));
      player.dispose();
    },
  );

  it("restores duplicate occurrences, queue order, shuffle order and paused position", async () => {
    const previousAudio = audioElement();
    const previous = createPlayer(previousAudio);
    const a = track("a.mp3");
    const b = track("b.mp3");
    previous.setTracks([a, b, track("removed-from-queue.mp3")]);
    previous.removeFromQueue(previous.getState().queue[2]!.id);
    previous.addTrack(a);
    const duplicate = previous.getState().queue[2]!;
    await previous.playId(duplicate.id);
    previous.setShuffle(true);
    previous.moveQueue(2, 1);
    previous.setRepeat("one");
    previous.setVolume(0.4);
    Object.defineProperty(previousAudio, "duration", { value: 120 });
    previousAudio.dispatchEvent(new Event("loadedmetadata"));
    previous.seek(74);
    const saved = previous.capturePlayback("root");
    expect(saved.current).toBe(1);
    expect(saved.order[0]).toBe(1);
    previous.dispose();

    const audio = audioElement();
    const play = vi.spyOn(audio, "play");
    const read = vi.spyOn(a.handle, "getFile").mockClear();
    const player = createPlayer(audio);
    player.setTracks([track("0-new.mp3"), a, b, track("removed-from-queue.mp3")]);
    const initialIds = player.getState().queue.map((entry) => entry.id);
    player.restorePlayback(readSavedPlayback(saved, "root")!);
    const restored = player.getState();
    expect(restored.queue.map(({ track }) => track.path)).toEqual([
      "a.mp3",
      "a.mp3",
      "b.mp3",
      "0-new.mp3",
    ]);
    expect(restored.queue.every(({ id }) => !initialIds.includes(id))).toBe(true);
    expect(restored.currentId).toBe(restored.queue[1]!.id);
    expect(player.capturePlayback("root").order).toEqual([...saved.order, 3]);
    expect(restored).toMatchObject({
      playing: false,
      currentTime: 74,
      duration: null,
      shuffle: true,
      repeat: "one",
      volume: 0.4,
    });
    expect(read).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(audio.volume).toBe(0.4);

    const starting = player.toggle();
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(audio.currentTime).toBe(0);
    expect(player.getState().currentTime).toBe(74);
    Object.defineProperty(audio, "duration", { value: 42 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    await starting;
    expect(audio.currentTime).toBe(42);
    expect(player.getState()).toMatchObject({ playing: true, currentTime: 42, duration: 42 });
    player.dispose();
  });

  it("removes a missing selection, preserves surviving duplicates and honors an empty queue", async () => {
    const audio = audioElement();
    const play = vi.spyOn(audio, "play");
    const player = createPlayer(audio);
    const a = track("a.mp3");
    const b = track("b.mp3");
    player.setTracks([a, b, track("excluded.mp3")]);
    player.removeFromQueue(player.getState().queue[2]!.id);
    player.addTrack(b);
    await player.playAt(0);
    Object.defineProperty(audio, "duration", { value: 30 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    player.seek(12);
    const saved = player.capturePlayback("root");
    player.setTracks([b, track("excluded.mp3"), track("new.mp3")]);
    play.mockClear();
    player.restorePlayback(saved);
    expect(player.getState().queue.map(({ track }) => track.path)).toEqual([
      "b.mp3",
      "b.mp3",
      "new.mp3",
    ]);
    expect(player.getState()).toMatchObject({ currentId: null, currentTime: 0, playing: false });
    expect(play).not.toHaveBeenCalled();

    for (const { id } of player.getState().queue) player.removeFromQueue(id);
    const empty = player.capturePlayback("root");
    player.setTracks([b, track("excluded.mp3"), track("new.mp3")]);
    player.restorePlayback(empty);
    expect(player.getState().queue).toEqual([]);
    player.updateTracks([b, track("excluded.mp3"), track("new.mp3"), track("discovered.mp3")]);
    expect(player.getState().queue.map(({ track }) => track.path)).toEqual(["discovered.mp3"]);
    player.setTracks([]);
    player.restorePlayback(saved);
    expect(player.getState()).toMatchObject({ queue: [], currentId: null, currentTime: 0 });
    player.dispose();
  });

  it("rejects unsupported data and ignores invalid playback values", () => {
    const player = createPlayer(audioElement());
    player.setTracks([track("a.mp3"), track("b.mp3")]);
    const saved = player.capturePlayback("root");
    expect(readSavedPlayback(saved, "other-root")).toBeUndefined();
    expect(readSavedPlayback({ ...saved, version: 2 }, "root")).toBeUndefined();
    expect(readSavedPlayback({ ...saved, queue: null }, "root")).toBeUndefined();
    for (const position of [NaN, Infinity, -1, "30"]) {
      expect(
        readSavedPlayback(
          { ...saved, order: [0, 0], current: 5, position, repeat: "bad", volume: 2 },
          "root",
        ),
      ).toMatchObject({
        order: [0, 1],
        current: null,
        position: 0,
        repeat: "off",
        volume: undefined,
      });
    }
    player.dispose();
  });

  it("keeps the resumed position on a canceled read and discards it on a different selection", async () => {
    const audio = audioElement();
    const play = vi.spyOn(audio, "play");
    const player = createPlayer(audio);
    const a = track("a.mp3");
    const slow = deferred<File>();
    vi.spyOn(a.handle, "getFile").mockReturnValueOnce(slow.promise);
    player.setTracks([a, track("b.mp3")]);
    const saved = player.capturePlayback("root");
    player.restorePlayback({ ...saved, current: 0, position: 15 });
    const starting = player.toggle();
    await player.toggle();
    expect(player.getState()).toMatchObject({ playing: false, currentTime: 15 });
    await player.playAt(1);
    slow.resolve(new File([], "a.mp3"));
    await starting;
    Object.defineProperty(audio, "duration", { value: 80 });
    audio.dispatchEvent(new Event("loadedmetadata"));
    expect(player.getState()).toMatchObject({ index: 1, playing: true, currentTime: 0 });
    expect(play).toHaveBeenCalledOnce();
    player.dispose();
  });
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
      expect(mediaSession.metadata).toMatchObject({ init: { title: "one" } });
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

  it("moves to the previous shuffled entry and does nothing at the start or without a selection", async () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setTracks([track("a"), track("b"), track("c")]);
    player.previous();
    expect(vi.spyOn(audio, "play")).not.toHaveBeenCalled();

    await player.playAt(0);
    player.setShuffle(true);
    const order = player.getState().order;
    player.previous();
    expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(1);
    player.next();
    await vi.waitFor(() =>
      expect(player.getState()).toMatchObject({ currentId: order[1], playing: true }),
    );
    player.previous();
    await vi.waitFor(() =>
      expect(player.getState()).toMatchObject({ currentId: order[0], playing: true }),
    );
    expect(vi.spyOn(audio, "play")).toHaveBeenCalledTimes(3);
    player.dispose();
  });

  it("clamps volume and ignores non-finite inputs", () => {
    const audio = audioElement();
    const player = createPlayer(audio);
    player.setVolume(0.4);
    player.setVolume(NaN);
    player.setVolume(Infinity);
    expect(audio.volume).toBe(0.4);
    expect(player.getState().volume).toBe(0.4);
    player.setVolume(1.5);
    expect(audio.volume).toBe(1);
    expect(player.getState().volume).toBe(1);
    player.setVolume(-1);
    expect(audio.volume).toBe(0);
    expect(player.getState().volume).toBe(0);
    player.dispose();
  });

  it("updates Media Session metadata only when the title changes while position continues updating", async () => {
    const media = {
      playbackState: "none",
      metadata: null as MediaMetadata | null,
      setActionHandler: vi.fn(),
      setPositionState: vi.fn(),
    };
    const metadataSet = vi.spyOn(media, "metadata", "set");
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: media });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: MediaMetadataInit) {}
      },
    );
    try {
      const audio = audioElement();
      const player = createPlayer(audio);
      player.setTracks([track("a"), track("b")]);
      await player.playAt(0);
      metadataSet.mockClear();
      media.setPositionState.mockClear();
      Object.defineProperty(audio, "duration", { configurable: true, value: 90 });
      audio.currentTime = 10;
      audio.dispatchEvent(new Event("timeupdate"));
      audio.currentTime = 20;
      audio.dispatchEvent(new Event("timeupdate"));
      expect(metadataSet).not.toHaveBeenCalled();
      expect(media.setPositionState).toHaveBeenLastCalledWith({
        duration: 90,
        position: 20,
        playbackRate: 1,
      });
      await player.playAt(1);
      expect(metadataSet).toHaveBeenCalledTimes(1);
      expect(metadataSet).toHaveBeenLastCalledWith(
        expect.objectContaining({ init: { title: "b", artist: "", album: "", artwork: [] } }),
      );
      const previous = player.getState();
      const originalSrc = audio.src;
      player.updateTracks(
        previous.tracks.map((item) =>
          item.name === "b"
            ? {
                ...item,
                metadata: { title: "Tagged", artist: "Artist", album: "Album" },
                artworkUrl: "blob:cover",
              }
            : item,
        ),
      );
      expect(metadataSet).toHaveBeenLastCalledWith(
        expect.objectContaining({
          init: {
            title: "Tagged",
            artist: "Artist",
            album: "Album",
            artwork: [{ src: "blob:cover" }],
          },
        }),
      );
      expect(audio.src).toBe(originalSrc);
      expect(player.getState().currentId).toBe(previous.currentId);
      expect(player.getState().order).toEqual(previous.order);
      expect(player.getState().playing).toBe(true);
      player.setTracks([]);
      expect(metadataSet).toHaveBeenLastCalledWith(null);
      player.dispose();
    } finally {
      Reflect.deleteProperty(navigator, "mediaSession");
      vi.unstubAllGlobals();
    }
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
