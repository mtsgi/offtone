import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { scanDirectory, type MusicDirectory, type Track } from "../lib/library";
import { loadDirectory, saveDirectory } from "../lib/storage";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";

vi.mock("../lib/library", () => ({ scanDirectory: vi.fn() }));

vi.mock("../lib/storage", () => ({
  loadDirectory: vi.fn(),
  saveDirectory: vi.fn(),
  queryDirectoryPermission: (directory: MusicDirectory) =>
    directory.queryPermission({ mode: "read" }),
  requestDirectoryPermission: (directory: MusicDirectory) =>
    directory.requestPermission({ mode: "read" }),
}));

function folder(permission: PermissionState): MusicDirectory {
  return {
    name: "Music",
    queryPermission: vi.fn().mockResolvedValue(permission),
    requestPermission: vi.fn().mockResolvedValue("granted"),
  } as unknown as MusicDirectory;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.stubGlobal("showDirectoryPicker", vi.fn());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ライブラリと再生ストア", () => {
  it("保存済みフォルダーの権限を再取得して再生キューを更新する", async () => {
    const saved = folder("prompt");
    const tracks = [{ name: "song.mp3", path: "song.mp3" }] as Track[];
    vi.mocked(loadDirectory).mockResolvedValue(saved);
    vi.mocked(scanDirectory).mockResolvedValue(tracks);
    const library = useLibraryStore();
    const player = usePlayerStore();

    await library.restore();
    expect(library.needsPermission).toBe(true);
    expect(player.tracks).toEqual([]);

    await library.restorePermission();
    expect(library.needsPermission).toBe(false);
    expect(library.folderName).toBe("Music");
    expect(player.tracks).toEqual(tracks);
  });

  it("再生サービスの状態変更を Pinia に反映し、ストアから再生を操作する", async () => {
    const player = usePlayerStore();
    const audioPlay = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue("blob:track"),
        revokeObjectURL: vi.fn(),
      }),
    );
    const track = {
      name: "song.mp3",
      path: "song.mp3",
      handle: { getFile: vi.fn().mockResolvedValue(new File(["audio"], "song.mp3")) },
    } as unknown as Track;
    player.setTracks([track]);
    await player.playAt(0);
    expect(audioPlay).toHaveBeenCalledOnce();
    expect(player.current).toEqual(track);
    expect(player.playing).toBe(true);
    player.$dispose();
  });

  it("新しいフォルダーを保存し、曲一覧を再生ストアに反映する", async () => {
    const selected = folder("granted");
    const tracks = [{ name: "new.flac", path: "new.flac" }] as Track[];
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory).mockResolvedValue(tracks);
    const library = useLibraryStore();
    const player = usePlayerStore();

    await library.selectFolder();
    expect(saveDirectory).toHaveBeenCalledWith(selected);
    expect(library.folderName).toBe("Music");
    expect(player.tracks).toEqual(tracks);
  });
});
