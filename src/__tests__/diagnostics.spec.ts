import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createDiagnostics, diagnostics } from "../lib/diagnostics";
import { createPlayer } from "../lib/player";
import type { Track } from "../lib/library";

afterEach(() => {
  diagnostics.setEnabled(false);
  diagnostics.clear();
  vi.unstubAllGlobals();
});

describe("diagnostics", () => {
  it("records only while enabled and retains the newest entries in order", () => {
    const log = createDiagnostics(2);
    log.record("marker");
    expect(log.snapshot()).toEqual([]);
    log.setEnabled(true);
    log.record("play");
    log.record("pause");
    log.record("ended");
    log.setEnabled(false);
    log.record("error");
    expect(log.snapshot().map((entry) => entry.event)).toEqual(["pause", "ended"]);
    log.clear();
    expect(log.snapshot()).toEqual([]);
  });

  it("exports an allowlist with anonymous track IDs and no names, paths or error messages", () => {
    const log = createDiagnostics();
    const item = {
      name: "private-song.mp3",
      path: "private/folder/private-song.mp3",
      handle: {},
    } as Track;
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "error", { value: { code: 3, message: "private/folder" } });
    log.setEnabled(true);
    log.record(
      "read-failure",
      audio,
      item,
      new DOMException("private/folder/private-song.mp3", "NotAllowedError"),
    );
    log.record("play", audio, item, new Error("private-song.mp3"));
    const entries = log.snapshot();
    expect(entries[0]).toMatchObject({
      event: "read-failure",
      track: 1,
      mediaErrorCode: 3,
      errorName: "NotAllowedError",
    });
    expect(entries[1]).toMatchObject({ track: 1, errorName: "other" });
    expect(JSON.stringify(entries)).not.toMatch(/private|song|folder/);
  });

  it("captures player events, media actions, visibility and failures without changing playback", async () => {
    const handlers = new Map<string, MediaSessionActionHandler | null>();
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: {
        playbackState: "none",
        metadata: null,
        setActionHandler: (action: string, handler: MediaSessionActionHandler | null) =>
          handlers.set(action, handler),
      },
    });
    const audio = document.createElement("audio");
    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    audio.pause = vi.fn();
    audio.load = vi.fn();
    audio.play = vi.fn(async () => {
      audio.dispatchEvent(new Event("play"));
    });
    URL.createObjectURL = vi.fn(() => "blob:test");
    URL.revokeObjectURL = vi.fn();
    const failed = {
      name: "secret.mp3",
      path: "secret.mp3",
      handle: { getFile: vi.fn().mockRejectedValue(new DOMException("secret", "NotFoundError")) },
    } as unknown as Track;
    const good = {
      name: "good.mp3",
      path: "good.mp3",
      handle: { getFile: vi.fn().mockResolvedValue(new File([], "good.mp3")) },
    } as unknown as Track;
    diagnostics.setEnabled(true);
    const player = createPlayer(audio);
    try {
      player.setTracks([failed, good]);
      await player.playAt(0);
      audio.dispatchEvent(new Event("waiting"));
      document.dispatchEvent(new Event("visibilitychange"));
      handlers.get("pause")?.({ action: "pause" });
      expect(player.getState().index).toBe(1);
      const entries = diagnostics.snapshot();
      expect(entries.map((entry) => entry.event)).toEqual(
        expect.arrayContaining([
          "play-request",
          "track-switch",
          "read-failure",
          "play",
          "waiting",
          "visibilitychange",
          "media-pause",
        ]),
      );
      expect(entries.find((entry) => entry.event === "read-failure")).toMatchObject({
        errorName: "NotFoundError",
        track: 1,
      });
      expect(JSON.stringify(entries)).not.toMatch(/secret|good\.mp3/);
    } finally {
      player.dispose();
      Reflect.deleteProperty(navigator, "mediaSession");
    }
  });
});
