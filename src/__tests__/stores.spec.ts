import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, disposePinia, getActivePinia, setActivePinia } from "pinia";
import { scanDirectory, type MusicDirectory, type Track } from "../lib/library";
import {
  loadDirectory,
  loadPlayback,
  saveDirectory,
  savePlayback,
  StorageError,
} from "../lib/storage";
import { trackId } from "../lib/catalog";
import type { SavedPlayback } from "../lib/playback-session";
import { useLibraryStore } from "../stores/library";
import { usePlayerStore } from "../stores/player";

vi.mock("../lib/library", () => ({ scanDirectory: vi.fn() }));

vi.mock("../lib/storage", () => ({
  StorageError: class StorageError extends Error {
    constructor(public kind: string) {
      super(kind);
    }
  },
  getTrack: vi.fn(),
  putTrack: vi.fn(),
  listTrackIds: vi.fn().mockResolvedValue([]),
  deleteTrack: vi.fn(),
  loadDirectory: vi.fn(),
  saveDirectory: vi.fn(),
  loadPlayback: vi.fn().mockResolvedValue(undefined),
  savePlayback: vi.fn().mockResolvedValue("playback"),
  queryDirectoryPermission: (directory: MusicDirectory) =>
    directory.queryPermission({ mode: "read" }),
  requestDirectoryPermission: (directory: MusicDirectory) =>
    directory.requestPermission({ mode: "read" }),
}));

function folder(permission: PermissionState, name = "Music"): MusicDirectory {
  return {
    name,
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
  disposePinia(getActivePinia()!);
  vi.useRealTimers();
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
      Object.defineProperty(this, "paused", { configurable: true, value: false });
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function playable(name: string): Track {
  return {
    name,
    path: name,
    handle: {
      getFile: vi.fn().mockResolvedValue(new File(["audio"], name)),
    } as unknown as FileSystemFileHandle,
  };
}

function savedSession(rootId = "root-id"): SavedPlayback {
  const a = trackId(rootId, "a.mp3");
  const b = trackId(rootId, "b.mp3");
  return {
    version: 1,
    rootId,
    library: [a, b],
    queue: [b, a, a],
    edited: true,
    order: [2, 1, 0],
    current: 2,
    position: 37,
    shuffle: true,
    repeat: "all",
    volume: 0.25,
  };
}

function mockAudio(): HTMLAudioElement {
  const audio = document.createElement("audio");
  let paused = true;
  Object.defineProperties(audio, {
    paused: { get: () => paused },
    duration: { value: 90 },
  });
  audio.play = vi.fn().mockImplementation(async () => {
    paused = false;
    audio.dispatchEvent(new Event("play"));
  });
  audio.pause = vi.fn().mockImplementation(() => {
    if (paused) return;
    paused = true;
    audio.dispatchEvent(new Event("pause"));
  });
  vi.stubGlobal(
    "Audio",
    vi.fn(function () {
      return audio;
    }),
  );
  vi.stubGlobal(
    "URL",
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn().mockReturnValue("blob:track"),
      revokeObjectURL: vi.fn(),
    }),
  );
  return audio;
}

describe("再生状態の永続化", () => {
  it("初回は通常キューで起動し、再生前の初期状態を書き込まない", async () => {
    const selected = folder("granted");
    vi.mocked(loadDirectory).mockResolvedValue(undefined);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    vi.mocked(scanDirectory).mockResolvedValue([playable("a.mp3")]);
    const library = useLibraryStore();
    await library.restore();
    expect(loadPlayback).not.toHaveBeenCalled();
    await library.selectFolder();
    expect(loadPlayback).toHaveBeenCalledExactlyOnceWith("root-id");
    expect(usePlayerStore().queue).toHaveLength(1);
    await usePlayerStore().flushPlayback();
    expect(savePlayback).not.toHaveBeenCalled();
  });

  it("権限拒否中は保存状態に触れず、再許可と走査の後に一度だけ復元する", async () => {
    const saved = folder("denied");
    const request = vi.fn().mockResolvedValueOnce("denied").mockResolvedValueOnce("granted");
    saved.requestPermission = request;
    vi.mocked(loadDirectory).mockResolvedValue(saved);
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    vi.mocked(loadPlayback).mockResolvedValueOnce(savedSession());
    vi.mocked(scanDirectory).mockResolvedValue([playable("a.mp3"), playable("b.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.restore();
    await library.restorePermission();
    expect(player.queue).toHaveLength(0);
    expect(scanDirectory).not.toHaveBeenCalled();
    expect(loadPlayback).not.toHaveBeenCalled();
    expect(savePlayback).not.toHaveBeenCalled();

    await library.restorePermission();
    expect(loadPlayback).toHaveBeenCalledExactlyOnceWith("root-id");
    expect(vi.mocked(scanDirectory).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(loadPlayback).mock.invocationCallOrder[0]!,
    );
    expect(player).toMatchObject({ playing: false, currentTime: 37, repeat: "all", volume: 0.25 });
    expect(player.currentId).toBe(player.queue[2]!.id);
    await library.refresh();
    expect(loadPlayback).toHaveBeenCalledTimes(1);
    expect(player.currentId).toBe(player.queue[2]!.id);
  });

  it("遅い復元より手動選曲を優先し、その操作を保存する", async () => {
    const play = vi.spyOn(mockAudio(), "play");
    const loaded = deferred<SavedPlayback>();
    vi.mocked(loadPlayback).mockReturnValueOnce(loaded.promise);
    vi.mocked(loadDirectory).mockResolvedValue(folder("granted"));
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    vi.mocked(scanDirectory).mockResolvedValue([playable("a.mp3"), playable("b.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    const restoring = library.restore();
    await vi.waitFor(() => expect(loadPlayback).toHaveBeenCalled());
    expect(savePlayback).not.toHaveBeenCalled();
    await player.playAt(1);
    loaded.resolve(savedSession());
    await restoring;
    await player.flushPlayback();
    expect(player.current?.path).toBe("b.mp3");
    expect(player).toMatchObject({ playing: true, currentTime: 0, shuffle: false });
    expect(play).toHaveBeenCalledOnce();
    expect(savePlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ current: 1, position: 0 }),
    );
  });

  it("同じ相対パスを含む別ルートに古い復元結果を適用しない", async () => {
    const oldFolder = folder("granted");
    oldFolder.isSameEntry = vi.fn().mockResolvedValue(false);
    const newFolder = folder("granted");
    const loaded = deferred<SavedPlayback>();
    vi.mocked(loadDirectory).mockResolvedValue(oldFolder);
    vi.mocked(saveDirectory).mockResolvedValueOnce("root-id").mockResolvedValueOnce("new-root");
    vi.mocked(loadPlayback)
      .mockReturnValueOnce(loaded.promise)
      .mockResolvedValueOnce(savedSession());
    vi.mocked(scanDirectory).mockResolvedValue([playable("a.mp3")]);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(newFolder));
    const library = useLibraryStore();
    const player = usePlayerStore();
    const restoring = library.restore();
    await vi.waitFor(() => expect(loadPlayback).toHaveBeenCalledWith("root-id"));
    await library.selectFolder();
    loaded.resolve(savedSession());
    await restoring;
    expect(loadPlayback).toHaveBeenLastCalledWith("new-root");
    expect(player.tracks[0]?.id).toBe(trackId("new-root", "a.mp3"));
    expect(player).toMatchObject({ currentId: null, currentTime: 0, playing: false });
    await player.flushPlayback();
    expect(savePlayback).not.toHaveBeenCalled();
  });

  it("位置を間引き、遅い保存の後に最新の位置と設定を保存する", async () => {
    vi.useFakeTimers();
    const audio = mockAudio();
    const player = usePlayerStore();
    player.setTracks([playable("a.mp3")]);
    await player.restorePlayback("root-id");
    await player.playAt(0);
    await player.flushPlayback();
    vi.mocked(savePlayback).mockClear();

    const slow = deferred<string>();
    vi.mocked(savePlayback).mockReturnValueOnce(slow.promise);
    for (const seconds of [1, 2, 3]) {
      audio.currentTime = seconds;
      audio.dispatchEvent(new Event("timeupdate"));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(savePlayback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(savePlayback).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ position: 3 }));

    player.setRepeat("one");
    audio.currentTime = 8;
    await player.toggle();
    const flushing = player.flushPlayback();
    expect(savePlayback).toHaveBeenCalledTimes(1);
    slow.resolve("playback");
    await flushing;
    expect(savePlayback).toHaveBeenCalledTimes(2);
    expect(savePlayback).toHaveBeenLastCalledWith(
      expect.objectContaining({ position: 8, repeat: "one" }),
    );
  });

  it("保存エラー時も再生でき、pagehide では最新位置を再試行する", async () => {
    const audio = mockAudio();
    const play = vi.spyOn(audio, "play");
    vi.mocked(loadPlayback).mockRejectedValueOnce(new StorageError("unavailable"));
    vi.mocked(savePlayback).mockRejectedValueOnce(new StorageError("quota"));
    const player = usePlayerStore();
    player.setTracks([playable("a.mp3")]);
    await player.restorePlayback("root-id");
    await player.playAt(0);
    expect(player.playing).toBe(true);
    expect(play).toHaveBeenCalledOnce();
    expect(savePlayback).toHaveBeenCalledTimes(1);

    audio.currentTime = 4;
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() =>
      expect(savePlayback).toHaveBeenLastCalledWith(expect.objectContaining({ position: 4 })),
    );
    await player.flushPlayback();
  });
});

describe("ライブラリ更新の競合", () => {
  it("再スキャンで再生中の音源と曲を維持し、更新したキューを反映する", async () => {
    const selected = folder("granted");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory)
      .mockResolvedValueOnce([playable("a.mp3"), playable("b.mp3")])
      .mockResolvedValueOnce([playable("b.mp3"), playable("c.mp3")]);
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue("blob:track"),
        revokeObjectURL: vi.fn(),
      }),
    );
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
    await player.playAt(1);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockClear();
    const load = vi.spyOn(HTMLMediaElement.prototype, "load").mockClear();
    await library.refresh();
    expect(player.current?.path).toBe("b.mp3");
    expect(player.index).toBe(0);
    expect(player.playing).toBe(true);
    expect(player.tracks.map((t) => t.path)).toEqual(["b.mp3", "c.mp3"]);
    expect(pause).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(vi.spyOn(URL, "revokeObjectURL")).not.toHaveBeenCalled();
    player.$dispose();
  });

  it("別ルートの同じ相対パスは同一曲とみなさず、選択の完了順を守る", async () => {
    const a = folder("granted");
    const b = folder("granted");
    a.isSameEntry = vi.fn().mockResolvedValue(false);
    const slow = deferred<Track[]>();
    const picker = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    vi.stubGlobal("showDirectoryPicker", picker);
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce([playable("same.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    const old = library.selectFolder();
    await vi.waitFor(() => expect(scanDirectory).toHaveBeenCalledTimes(1));
    await library.selectFolder();
    slow.resolve([playable("old.mp3")]);
    await old;
    expect(library.directory).toBe(b);
    expect(player.tracks[0]?.name).toBe("same.mp3");
    expect(saveDirectory).toHaveBeenCalledTimes(1);

    vi.mocked(picker).mockResolvedValueOnce(a);
    vi.mocked(scanDirectory).mockResolvedValueOnce([playable("same.mp3")]);
    b.isSameEntry = vi.fn().mockResolvedValue(false);
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue("blob:track"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
    player.setTracks([playable("same.mp3")]);
    await player.playAt(0);
    expect(player.playing).toBe(true);
    await library.selectFolder();
    expect(player.index).toBe(-1);
    expect(library.directory).toBe(a);
  });

  it("同一フォルダーの連続更新で古い成功や失敗を無視する", async () => {
    const selected = folder("granted");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory).mockResolvedValueOnce([playable("initial.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.selectFolder();
    const slow = deferred<Track[]>();
    const olderFailure = deferred<Track[]>();
    const latest = deferred<Track[]>();
    vi.mocked(scanDirectory)
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(olderFailure.promise)
      .mockReturnValueOnce(latest.promise);
    const first = library.refresh();
    const second = library.refresh();
    const third = library.refresh();
    slow.resolve([playable("old.mp3")]);
    olderFailure.reject(new Error("old error"));
    await Promise.all([first, second]);
    expect(library.busy).toBe(true);
    expect(library.status).toBe("");
    latest.resolve([playable("new.mp3")]);
    await third;
    expect(player.tracks[0]?.name).toBe("new.mp3");
    expect(library.busy).toBe(false);
  });

  it("権限失効と読み取りエラーで正常なキューを保持し、再試行で復旧する", async () => {
    const selected = folder("granted");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory)
      .mockResolvedValueOnce([playable("original.mp3")])
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockRejectedValueOnce(new Error("read error"))
      .mockResolvedValueOnce([playable("recovered.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.selectFolder();
    await library.refresh();
    expect(library.needsPermission).toBe(true);
    expect(player.tracks[0]?.name).toBe("original.mp3");
    await library.restorePermission();
    expect(library.status).not.toBe("");
    expect(player.tracks[0]?.name).toBe("original.mp3");
    await library.restorePermission();
    expect(library.needsPermission).toBe(false);
    expect(library.status).toBe("");
    expect(player.tracks[0]?.name).toBe("recovered.mp3");
  });
  it("同じルートを別ハンドルで再選択しても現在曲を維持する", async () => {
    const first = folder("granted");
    const second = folder("granted");
    first.isSameEntry = vi.fn().mockResolvedValue(true);
    vi.stubGlobal(
      "showDirectoryPicker",
      vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
    );
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn().mockReturnValue("blob:track"),
        revokeObjectURL: vi.fn(),
      }),
    );
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
    await player.playAt(0);
    await library.selectFolder();
    expect(vi.spyOn(first, "isSameEntry")).toHaveBeenCalledWith(second);
    expect(player).toMatchObject({ index: 0, playing: true });
    expect(player.current?.path).toBe("song.mp3");
    player.$dispose();
  });

  it("フォルダー保存の遅延が新しい選択の保存を上書きしない", async () => {
    const a = folder("granted");
    const b = folder("granted");
    a.isSameEntry = vi.fn().mockResolvedValue(false);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b));
    vi.mocked(scanDirectory).mockResolvedValue([]);
    const saving = deferred<string>();
    vi.mocked(saveDirectory)
      .mockReturnValueOnce(saving.promise)
      .mockResolvedValueOnce("music-directory");
    const library = useLibraryStore();
    const first = library.selectFolder();
    await vi.waitFor(() => expect(saveDirectory).toHaveBeenCalledWith(a));
    const second = library.selectFolder();
    await vi.waitFor(() => expect(library.directory).toBe(b));
    expect(saveDirectory).toHaveBeenCalledTimes(1);
    saving.resolve("music-directory");
    await Promise.all([first, second]);
    expect(vi.mocked(saveDirectory).mock.calls.map(([saved]) => saved)).toEqual([a, b]);
  });
  it("新しく選択したフォルダーの権限失効後、元のキューを保持して再許可・保存する", async () => {
    const original = folder("granted", "Original");
    const selected = folder("granted", "New");
    original.isSameEntry = vi.fn().mockResolvedValue(false);
    vi.stubGlobal(
      "showDirectoryPicker",
      vi.fn().mockResolvedValueOnce(original).mockResolvedValueOnce(selected),
    );
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory)
      .mockResolvedValueOnce([playable("original.mp3")])
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockResolvedValueOnce([playable("new.mp3")]);
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.selectFolder();
    await library.selectFolder();
    expect(library.directory).toBe(original);
    expect(library.folderName).toBe("Original");
    expect(library.permissionFolderName).toBe("New");
    expect(library.needsPermission).toBe(true);
    expect(player.tracks[0]?.name).toBe("original.mp3");
    expect(saveDirectory).toHaveBeenCalledTimes(1);
    await library.restorePermission();
    expect(vi.spyOn(selected, "requestPermission")).toHaveBeenCalledWith({ mode: "read" });
    expect(library.directory).toBe(selected);
    expect(library.folderName).toBe("New");
    expect(library.needsPermission).toBe(false);
    expect(player.tracks[0]?.name).toBe("new.mp3");
    expect(vi.mocked(saveDirectory).mock.calls.map(([saved]) => saved)).toEqual([
      original,
      selected,
    ]);
  });

  it("初回のフォルダー選択で権限が失効しても再許可できる", async () => {
    const selected = folder("granted", "New");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(saveDirectory).mockResolvedValue("music-directory");
    vi.mocked(scanDirectory)
      .mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"))
      .mockResolvedValueOnce([playable("new.mp3")]);
    const library = useLibraryStore();
    await library.selectFolder();
    expect(library.directory).toBeUndefined();
    expect(library.needsPermission).toBe(true);
    expect(library.permissionFolderName).toBe("New");
    await library.restorePermission();
    expect(library.directory).toBe(selected);
    expect(library.needsPermission).toBe(false);
    expect(saveDirectory).toHaveBeenCalledWith(selected);
  });
});

describe("権限と保存の復旧", () => {
  it.each([
    ["quota", "空き容量を確保"],
    ["blocked", "他のタブを閉じて"],
  ] as const)("復元中の %s エラーを案内し、再試行で復旧する", async (kind, guidance) => {
    const saved = folder("granted");
    vi.mocked(loadDirectory)
      .mockRejectedValueOnce(new StorageError(kind))
      .mockResolvedValueOnce(saved);
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    const library = useLibraryStore();
    const player = usePlayerStore();
    player.setTracks([playable("existing.mp3")]);

    await library.restore();
    expect(library.status).toContain(guidance);
    expect(library.status).toContain("再読み込み");
    expect(library.busy).toBe(false);
    expect(player.tracks[0]?.path).toBe("existing.mp3");
    expect(scanDirectory).not.toHaveBeenCalled();

    await library.restore();
    expect(library.status).toBe("");
    expect(player.tracks[0]?.path).toBe("song.mp3");
  });

  it("初回保存中に再スキャンしても完了後に安定 ID を割り当てる", async () => {
    const selected = folder("granted");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    const saving = deferred<string>();
    vi.mocked(saveDirectory).mockReturnValueOnce(saving.promise).mockResolvedValueOnce("root-id");
    const library = useLibraryStore();
    const first = library.selectFolder();
    await vi.waitFor(() => expect(saveDirectory).toHaveBeenCalledWith(selected));
    const refresh = library.refresh();
    saving.resolve("root-id");
    await Promise.all([first, refresh]);
    expect(usePlayerStore().tracks[0]?.id).toBe(JSON.stringify(["root-id", "song.mp3"]));
  });

  it("granted の保存済みフォルダーを要求ダイアログなしで復元する", async () => {
    const saved = folder("granted");
    const request = vi.fn();
    saved.requestPermission = request;
    vi.mocked(loadDirectory).mockResolvedValue(saved);
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    const library = useLibraryStore();
    await library.restore();
    expect(request).not.toHaveBeenCalled();
    expect(library.needsPermission).toBe(false);
    expect(usePlayerStore().tracks[0]?.id).toBe(JSON.stringify(["root-id", "song.mp3"]));
  });

  it("denied の復元時は要求せず、操作による拒否の後に再許可できる", async () => {
    const saved = folder("denied");
    const request = vi.fn().mockResolvedValueOnce("denied").mockResolvedValueOnce("granted");
    saved.requestPermission = request;
    vi.mocked(loadDirectory).mockResolvedValue(saved);
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    const library = useLibraryStore();
    const player = usePlayerStore();
    await library.restore();
    expect(request).not.toHaveBeenCalled();
    expect(library.permissionState).toBe("denied");
    await library.restorePermission();
    expect(library.needsPermission).toBe(true);
    await library.restorePermission();
    expect(library.needsPermission).toBe(false);
    expect(player.tracks[0]?.id).toBe(JSON.stringify(["root-id", "song.mp3"]));
  });

  it("古い再許可の結果が新しいフォルダーを上書きしない", async () => {
    const saved = folder("prompt");
    const next = folder("granted", "Next");
    const permission = deferred<PermissionState>();
    saved.requestPermission = vi.fn().mockReturnValue(permission.promise);
    vi.mocked(loadDirectory).mockResolvedValue(saved);
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(next));
    vi.mocked(scanDirectory).mockResolvedValue([playable("next.mp3")]);
    vi.mocked(saveDirectory).mockResolvedValue("root-id");
    const library = useLibraryStore();
    await library.restore();
    const old = library.restorePermission();
    await library.selectFolder();
    permission.resolve("granted");
    await old;
    expect(library.directory).toBe(next);
    expect(library.needsPermission).toBe(false);
    expect(scanDirectory).toHaveBeenCalledTimes(1);
  });

  it("保存に失敗しても曲一覧を使え、容量不足を案内する", async () => {
    const selected = folder("granted");
    vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(selected));
    vi.mocked(scanDirectory).mockResolvedValue([playable("song.mp3")]);
    vi.mocked(saveDirectory).mockRejectedValue(new StorageError("quota"));
    const library = useLibraryStore();
    await library.selectFolder();
    expect(usePlayerStore().tracks[0]?.path).toBe("song.mp3");
    expect(library.status).toContain("保存領域が不足");
  });
});
