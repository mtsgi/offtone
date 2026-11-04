import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, watchEffect } from "vue";
import type { TrackRecord } from "../lib/catalog";
import type { MusicDirectory, Track } from "../lib/library";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  stop: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  scan: vi.fn(),
}));
vi.mock("../lib/metadata-worker", () => ({
  MetadataWorker: class {
    parse = mocks.parse;
    stop = mocks.stop;
  },
}));
vi.mock("../lib/library", () => ({ scanDirectory: mocks.scan }));
vi.mock("../lib/storage", () => ({
  StorageError: class extends Error {},
  loadDirectory: vi.fn(),
  saveDirectory: vi.fn().mockResolvedValue("root"),
  queryDirectoryPermission: vi.fn(),
  requestDirectoryPermission: vi.fn(),
  getTrack: mocks.get,
  putTrack: mocks.put,
  listTrackIds: vi.fn().mockResolvedValue([]),
  deleteTrack: vi.fn(),
}));
let selected: MusicDirectory;
let file: File;
let track: Track;
beforeEach(() => {
  setActivePinia(createPinia());
  selected = { name: "Music", isSameEntry: async () => true } as unknown as MusicDirectory;
  file = new File(["audio"], "song.mp3", { lastModified: 10 });
  track = {
    name: file.name,
    path: file.name,
    handle: { getFile: () => Promise.resolve(file) } as FileSystemFileHandle,
  };
  mocks.scan.mockResolvedValue([track]);
  mocks.get.mockResolvedValue(undefined);
  mocks.put.mockResolvedValue("id");
  mocks.parse.mockResolvedValue({ metadata: { title: "Tagged" } });
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function waitForAnalysis() {
  const library = useLibraryStore();
  await vi.waitFor(() => expect(library.analysis.active).toBe(false));
}

describe("metadata cache integration", () => {
  it("reuses unchanged metadata and reparses changed files and versions", async () => {
    let cached: TrackRecord | undefined;
    mocks.get.mockImplementation(async () => cached);
    mocks.put.mockImplementation(async (record: TrackRecord) => {
      cached = record;
    });
    const library = useLibraryStore();
    await library.selectFolder();
    await waitForAnalysis();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(usePlayerStore().tracks[0]?.metadata?.title).toBe("Tagged");
    await library.refresh();
    await waitForAnalysis();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    file = new File(["changed"], "song.mp3", { lastModified: 11 });
    await library.refresh();
    await waitForAnalysis();
    expect(mocks.parse).toHaveBeenCalledTimes(2);
    cached!.metadataVersion = 0;
    await library.refresh();
    await waitForAnalysis();
    expect(mocks.parse).toHaveBeenCalledTimes(3);
    library.$dispose();
  });
  it("reparses version 1 cached metadata for album artist without clearing the database", async () => {
    mocks.get.mockResolvedValue({
      id: "old",
      rootId: "root",
      path: track.path,
      size: file.size,
      lastModified: file.lastModified,
      metadataVersion: 1,
      metadata: { title: "Old" },
    });
    mocks.parse.mockResolvedValue({ metadata: { title: "New", albumArtist: "Various" } });
    const library = useLibraryStore();
    await library.selectFolder();
    await waitForAnalysis();
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(usePlayerStore().tracks[0]?.metadata?.albumArtist).toBe("Various");
    expect(mocks.put).toHaveBeenCalledWith(
      expect.objectContaining({ metadataVersion: 2 }),
      expect.any(AbortSignal),
    );
    library.$dispose();
  });
  it("ignores a cancelled result and retries after a write failure", async () => {
    let resolve!: (value: unknown) => void;
    mocks.parse.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const library = useLibraryStore();
    await library.selectFolder();
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalled());
    library.cancelAnalysis();
    resolve({ metadata: { title: "Old" } });
    await Promise.resolve();
    expect(mocks.put).not.toHaveBeenCalled();
    expect(usePlayerStore().tracks[0]?.metadata).toBeUndefined();
    mocks.put.mockRejectedValueOnce(new Error("quota"));
    await library.analyze();
    expect(usePlayerStore().tracks[0]?.metadata?.title).toBe("Tagged");
    expect(library.analysisStatus).toContain("保存できません");
    library.$dispose();
  });
  it("ignores an old folder result after switching folders", async () => {
    let resolve!: (value: unknown) => void;
    mocks.parse.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const library = useLibraryStore();
    await library.selectFolder();
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalledTimes(1));
    const nextFolder = {
      name: "Other",
      isSameEntry: async () => false,
    } as unknown as MusicDirectory;
    const nextTrack = { ...track, name: "other.mp3", path: "other.mp3" };
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(nextFolder));
    mocks.scan.mockResolvedValue([nextTrack]);
    await library.selectFolder();
    await waitForAnalysis();
    resolve({ metadata: { title: "Old folder" } });
    await Promise.resolve();
    expect(usePlayerStore().tracks[0]?.metadata?.title).toBe("Tagged");
    expect(mocks.put).toHaveBeenCalledTimes(1);
    library.$dispose();
  });
  it("revokes artwork URLs when they are replaced and the store is disposed", async () => {
    const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revoke = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const artwork = new Blob(["cover"]);
    mocks.parse.mockResolvedValue({ metadata: { title: "Tagged" }, artwork });
    const library = useLibraryStore();
    await library.selectFolder();
    await waitForAnalysis();
    await library.analyze();
    expect(revoke).toHaveBeenCalledWith("blob:first");
    library.$dispose();
    expect(revoke).toHaveBeenCalledWith("blob:second");
  });
  it("updates only the reactive track while keeping the playing queue and Media Session", async () => {
    let resolve!: (value: unknown) => void;
    mocks.parse.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const media = { playbackState: "none", metadata: null, setActionHandler: vi.fn() };
    Object.defineProperty(navigator, "mediaSession", { configurable: true, value: media });
    vi.stubGlobal(
      "MediaMetadata",
      class {
        constructor(public init: MediaMetadataInit) {}
      },
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:audio");
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.selectFolder();
    await vi.waitFor(() => expect(mocks.parse).toHaveBeenCalled());
    await player.playAt(0);
    player.setShuffle(true);
    player.setRepeat("all");
    player.addTrack({ ...player.tracks[0]! });
    const updateTracks = vi.spyOn(player, "updateTracks");
    const queue = player.queue;
    const order = player.order;
    const currentId = player.currentId;
    const observed: Array<string | undefined> = [];
    const stop = watchEffect(() => {
      observed.push(player.current?.metadata?.title);
    });
    resolve({ metadata: { title: "New title", artist: "Artist" } });
    await waitForAnalysis();
    await nextTick();
    expect(observed).toEqual([undefined, "New title"]);
    expect(updateTracks).not.toHaveBeenCalled();
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.currentId).toBe(currentId);
    expect(player.playing).toBe(true);
    expect(player.repeat).toBe("all");
    expect(player.shuffle).toBe(true);
    expect(player.queue.every((entry) => entry.track.metadata?.title === "New title")).toBe(true);
    expect(media.metadata).toMatchObject({ init: { title: "New title", artist: "Artist" } });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    stop();
    library.$dispose();
    player.$dispose();
    Reflect.deleteProperty(navigator, "mediaSession");
  });
});
