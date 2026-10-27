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
  audio.play = vi.fn().mockImplementation(async () => audio.dispatchEvent(new Event("play")));
  audio.pause = vi.fn().mockImplementation(() => audio.dispatchEvent(new Event("pause")));
  audio.load = vi.fn();
  return audio;
}

beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValue("blob:track");
  URL.revokeObjectURL = vi.fn();
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
    audio.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(player.getState().index).toBe(1));
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    audio.dispatchEvent(new Event("ended"));
    expect(player.getState().index).toBe(1);
    expect(player.getState().playing).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
