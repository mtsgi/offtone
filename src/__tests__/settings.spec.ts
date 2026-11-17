import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { useSettingsStore } from "../stores/settings";
import { loadDirectory, loadSettings, saveSettings } from "../lib/storage";
import * as storage from "../lib/storage";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  setActivePinia(createPinia());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("settings", () => {
  it("defaults to metadata and restores once without creating saved preferences", async () => {
    const settings = useSettingsStore();
    expect(settings.albumGrouping).toBe("metadata");
    const read = vi.spyOn(storage, "loadSettings");
    await Promise.all([settings.restore(), settings.restore()]);
    expect(settings.ready).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await loadSettings()).toBeUndefined();
  });
  it("saves and restores across store instances without touching directory handles or other keys", async () => {
    await loadSettings();
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("offtone", 2);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ name: "Music" }, "music-directory");
        tx.objectStore("settings").put("keep", "other");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    const settings = useSettingsStore();
    await settings.restore();
    await settings.setAlbumGrouping("folder");
    expect(await loadSettings()).toEqual({ albumGrouping: "folder" });
    expect(await loadDirectory()).toEqual({ name: "Music" });
    const restored = useSettingsStore(createPinia());
    await restored.restore();
    expect(restored.albumGrouping).toBe("folder");
    expect(restored.saveFailed).toBe(false);
    await new Promise<void>((resolve) => {
      const request = indexedDB.open("offtone", 2);
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
      expect(settings.albumGrouping).toBe("metadata");
      expect(settings.ready).toBe(true);
    },
  );
  it("uses defaults when reads fail and keeps a failed live selection available for retry", async () => {
    vi.spyOn(storage, "loadSettings").mockRejectedValueOnce(new Error("unavailable"));
    const settings = useSettingsStore();
    await settings.restore();
    expect(settings.status).toContain("読み込めません");
    expect(settings.ready).toBe(true);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await settings.setAlbumGrouping("folder");
    expect(settings.albumGrouping).toBe("folder");
    expect(settings.saveFailed).toBe(true);
    expect(settings.saving).toBe(false);
    expect(settings.status).toContain("今回のみ有効");
    put.mockRestore();
    await settings.setAlbumGrouping("folder");
    expect(settings.saveFailed).toBe(false);
    expect(await loadSettings()).toEqual({ albumGrouping: "folder" });
  });
  it("does not let a late startup read override a newer selection", async () => {
    let finish!: (value: unknown) => void;
    vi.spyOn(storage, "loadSettings").mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const settings = useSettingsStore();
    const restoring = settings.restore();
    await settings.setAlbumGrouping("folder");
    finish({ albumGrouping: "metadata" });
    await restoring;
    expect(settings.albumGrouping).toBe("folder");
  });
  it("serializes rapid changes and recovers after a failed write", async () => {
    const saved: string[] = [];
    let finish!: () => void;
    const write = vi
      .spyOn(storage, "saveSettings")
      .mockImplementationOnce(
        (settings) =>
          new Promise((resolve) => {
            saved.push(settings.albumGrouping);
            finish = () => resolve("app-settings");
          }),
      )
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockImplementation(async (settings) => {
        saved.push(settings.albumGrouping);
        return "app-settings";
      });
    const settings = useSettingsStore();
    const a = settings.setAlbumGrouping("folder");
    const b = settings.setAlbumGrouping("metadata");
    const c = settings.setAlbumGrouping("folder");
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(settings.albumGrouping).toBe("folder");
    finish();
    await Promise.all([a, b, c]);
    expect(saved).toEqual(["folder", "folder"]);
    expect(settings.saveFailed).toBe(false);
    expect(settings.saving).toBe(false);
  });
  it("does not replace saved preferences when runtime callers pass invalid values", async () => {
    await saveSettings({ albumGrouping: "folder" });
    const settings = useSettingsStore();
    await settings.restore();
    // @ts-expect-error runtime data must be validated too
    await settings.setAlbumGrouping("invalid");
    expect(settings.albumGrouping).toBe("folder");
    expect(await loadSettings()).toEqual({ albumGrouping: "folder" });
  });
});
