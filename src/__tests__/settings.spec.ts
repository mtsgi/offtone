import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { useSettingsStore } from "../stores/settings";
import { DEFAULT_SETTINGS, type AppSettings } from "../lib/settings";
import { loadDirectory, loadSettings } from "../lib/storage";
import * as storage from "../lib/storage";
import { readThemeHint, saveThemeHint } from "../lib/theme";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  setActivePinia(createPinia());
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function writeLegacySettings() {
  await loadSettings();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("offtone", 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("settings", "readwrite");
      const store = tx.objectStore("settings");
      store.put({ albumGrouping: "folder" }, "app-settings");
      store.put({ name: "Music" }, "music-directory");
      store.put("keep", "other");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

describe("settings", () => {
  it("defaults to library order, metadata grouping and system appearance without writing to IndexedDB", async () => {
    const settings = useSettingsStore();
    expect(settings.preferences).toEqual(DEFAULT_SETTINGS);
    const read = vi.spyOn(storage, "loadSettings");
    await Promise.all([settings.restore(), settings.restore()]);
    expect(settings.ready).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await loadSettings()).toBeUndefined();
  });

  it("restores legacy folder grouping, repairs a stale theme hint, and saves new fields without touching other keys", async () => {
    await writeLegacySettings();
    saveThemeHint("dark");
    const settings = useSettingsStore();
    expect(settings.theme).toBe("dark");
    await settings.restore();
    expect(settings.preferences).toEqual({ ...DEFAULT_SETTINGS, albumGrouping: "folder" });
    expect(readThemeHint()).toBe("system");
    expect(await loadSettings()).toEqual({ albumGrouping: "folder" });

    await Promise.all([
      settings.setSortKey("tracks", "title"),
      settings.setSortDirection("tracks", "desc"),
      settings.setSortKey("albums", "artist"),
      settings.setSortDirection("albums", "desc"),
      settings.setSortKey("artists", "artist"),
      settings.setSortDirection("artists", "desc"),
      settings.setTheme("dark"),
    ]);
    const expected = {
      albumGrouping: "folder",
      librarySort: {
        tracks: { key: "title", direction: "desc" },
        albums: { key: "artist", direction: "desc" },
        artists: { key: "artist", direction: "desc" },
      },
      theme: "dark",
    };
    expect(await loadSettings()).toEqual(expected);
    expect(readThemeHint()).toBe("dark");
    expect(await loadDirectory()).toEqual({ name: "Music" });
    const restored = useSettingsStore(createPinia());
    expect(restored.theme).toBe("dark");
    await restored.restore();
    expect(restored.preferences).toEqual(expected);
    expect(restored.saveFailed).toBe(false);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("offtone", 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("settings").objectStore("settings").get("other");
        read.onsuccess = () => {
          expect(read.result).toBe("keep");
          db.close();
          resolve();
        };
      };
    });
  });

  it.each([null, "folder", {}, { albumGrouping: "invalid" }, { albumGrouping: 1 }])(
    "falls back safely for invalid stored data %j",
    async (saved) => {
      vi.spyOn(storage, "loadSettings").mockResolvedValue(saved);
      const settings = useSettingsStore();
      await settings.restore();
      expect(settings.preferences).toEqual(DEFAULT_SETTINGS);
      expect(settings.ready).toBe(true);
    },
  );

  it("validates each saved field independently and rejects invalid runtime selections", async () => {
    vi.spyOn(storage, "loadSettings").mockResolvedValue({
      albumGrouping: "folder",
      librarySort: {
        tracks: { key: "title", direction: "wrong" },
        albums: { key: "title", direction: "desc" },
        artists: { key: "album", direction: 1 },
      },
      theme: "sepia",
    });
    const write = vi.spyOn(storage, "saveSettings");
    const settings = useSettingsStore();
    await settings.restore();
    const expected = {
      albumGrouping: "folder",
      librarySort: {
        tracks: { key: "title", direction: "asc" },
        albums: { key: "library", direction: "desc" },
        artists: { key: "library", direction: "asc" },
      },
      theme: "system",
    };
    expect(settings.preferences).toEqual(expected);
    await settings.setAlbumGrouping("invalid");
    await settings.setSortKey("albums", "title");
    await settings.setSortKey("unknown", "artist");
    await settings.setSortDirection("artists", "wrong");
    await settings.setSortDirection("unknown", "desc");
    await settings.setTheme("sepia");
    expect(settings.preferences).toEqual(expected);
    expect(write).not.toHaveBeenCalled();
  });

  it("retains the startup theme on read failure and retries a failed save with the live selection", async () => {
    saveThemeHint("light");
    vi.spyOn(storage, "loadSettings").mockRejectedValueOnce(new Error("unavailable"));
    const settings = useSettingsStore();
    await settings.restore();
    expect(settings.status).toContain("読み込めません");
    expect(settings.ready).toBe(true);
    expect(settings.preferences).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await settings.setTheme("dark");
    expect(settings.theme).toBe("dark");
    expect(readThemeHint()).toBe("light");
    expect(settings.saveFailed).toBe(true);
    expect(settings.saving).toBe(false);
    expect(settings.status).toContain("今回のみ有効");
    put.mockRestore();
    await settings.retrySave();
    expect(settings.saveFailed).toBe(false);
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(readThemeHint()).toBe("dark");
  });

  it("merges changes requested during startup with the restored preferences", async () => {
    let finish!: (value: unknown) => void;
    vi.spyOn(storage, "loadSettings").mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const settings = useSettingsStore();
    const restoring = settings.restore();
    const changed = settings.setTheme("dark");
    expect(await loadSettings()).toBeUndefined();
    finish({ albumGrouping: "folder", theme: "light" });
    await Promise.all([restoring, changed]);
    expect(await loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      albumGrouping: "folder",
      theme: "dark",
    });
    expect(settings.theme).toBe("dark");
  });

  it("serializes fast changes and recovers after a failed write", async () => {
    const settings = useSettingsStore();
    await settings.restore();
    const saveSettings = storage.saveSettings;
    const saved: AppSettings[] = [];
    let finish!: () => void;
    const write = vi
      .spyOn(storage, "saveSettings")
      .mockImplementationOnce(
        (settings) =>
          new Promise((resolve) => {
            saved.push(settings);
            finish = () => resolve("app-settings");
          }),
      )
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockImplementation((settings) => {
        saved.push(settings);
        return saveSettings(settings);
      });
    const a = settings.setTheme("dark");
    const b = settings.setSortKey("tracks", "title");
    const c = settings.setTheme("light");
    const d = settings.setSortDirection("tracks", "desc");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(settings.theme).toBe("light");
    expect(settings.saving).toBe(true);
    expect(readThemeHint()).toBe("system");
    finish();
    await Promise.all([a, b, c, d]);
    expect(saved.map(({ theme }) => theme)).toEqual(["dark", "light", "light"]);
    expect(await loadSettings()).toEqual(settings.preferences);
    expect(readThemeHint()).toBe("light");
    expect(settings.librarySort.tracks).toEqual({ key: "title", direction: "desc" });
    expect(settings.saveFailed).toBe(false);
    expect(settings.saving).toBe(false);
  });

  it("restores the committed theme even if the startup hint cannot be written or read", async () => {
    const settings = useSettingsStore();
    await settings.restore();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await settings.setTheme("dark");
    expect(settings.saveFailed).toBe(false);
    expect(readThemeHint()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const restored = useSettingsStore(createPinia());
    await restored.restore();
    expect(restored.theme).toBe("dark");
  });
});
