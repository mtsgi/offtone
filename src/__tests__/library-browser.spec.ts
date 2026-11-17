import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp, h, nextTick, ref, vaporInteropPlugin } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import ui from "@nuxt/ui/vue-plugin";
import LibraryBrowser from "../components/LibraryBrowser.vue";
import { useSettingsStore } from "../stores/settings";
import { usePlayerStore } from "../stores/player";
import type { MusicDirectory, Track } from "../lib/library";

const track = (path: string, title: string, album: string): Track => ({
  path,
  name: path.split("/").pop()!,
  metadata: { title, album, artist: "Artist" },
  handle: { getFile: async () => new File(["audio"], path) } as FileSystemFileHandle,
});
let root: HTMLElement;
let app: ReturnType<typeof createApp>;
let player: ReturnType<typeof usePlayerStore>;
let audio: HTMLAudioElement;
let created: ReturnType<typeof vi.fn>;
let directory: ReturnType<typeof ref<MusicDirectory | undefined>>;
const tick = async () => {
  await nextTick();
  await Promise.resolve();
  await nextTick();
};
function findButton(text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().includes(text),
  );
  if (!found) throw new Error(`Missing button ${text}`);
  return found;
}
async function filterLibrary(value: string) {
  const search = root.querySelector<HTMLInputElement>("#library-search")!;
  search.value = value;
  search.dispatchEvent(new Event("input"));
  await tick();
}
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  created = vi.fn(function () {
    audio = document.createElement("audio");
    return audio;
  });
  vi.stubGlobal("Audio", created);
  URL.createObjectURL = vi.fn().mockReturnValue("blob:audio");
  URL.revokeObjectURL = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
  const pinia = createPinia();
  player = usePlayerStore(pinia);
  player.setTracks([
    track("one.mp3", "First", "One"),
    track("two.mp3", "Second", "Two"),
    track("three.mp3", "Third", "Two"),
  ]);
  directory = ref({ name: "one" } as MusicDirectory);
  app = createApp({
    setup: () => () => h(LibraryBrowser, { tracks: player.tracks, directory: directory.value }),
  })
    .use(vaporInteropPlugin)
    .use(pinia)
    .use(createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: {} }] }))
    .use(ui);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  player.$dispose();
  root.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("library browser", () => {
  it.each(["metadata", "folder"] as const)(
    "keeps artist album counts, list and detail in sync as searches change in %s mode",
    async (mode) => {
      player.setTracks([
        track("spring/one.mp3", "First", "春"),
        track("spring/two.mp3", "Second", "春"),
        track("winter/three.mp3", "Third", "冬"),
      ]);
      await useSettingsStore().setAlbumGrouping(mode);
      findButton("アーティスト").click();
      await filterLibrary("春");
      expect(findButton("Artist").textContent).toContain("1 アルバム · 2 曲");
      findButton("Artist").click();
      await tick();

      for (const [query, names, count] of [
        ["春", ["春"], 2],
        ["冬", ["冬"], 1],
        ["", ["春", "冬"], 3],
        ["missing", [], 0],
        ["春", ["春"], 2],
      ] as const) {
        await filterLibrary(query);
        const items = [...root.querySelectorAll('[aria-label="関連アルバム"] li')];
        expect(items).toHaveLength(names.length);
        expect(items.map((item) => item.textContent?.trim())).toEqual(
          names.map((name) => `${name} · Artist`),
        );
        const header = root.querySelector("#library-panel h2")!.parentElement!;
        expect(header.textContent?.replace(/\s+/g, " ")).toContain(
          `${names.length} アルバム · ${count} 曲`,
        );
        expect(root.querySelectorAll('[aria-label="曲一覧"] li')).toHaveLength(count);
        expect(root.textContent).toContain("一覧に戻る"); // A zero-result search keeps the detail open.
        if (count) {
          findButton("一覧に戻る").click();
          await tick();
          expect(findButton("Artist").textContent).toContain(
            `${names.length} アルバム · ${count} 曲`,
          );
          findButton("Artist").click();
          await tick();
        }
      }
    },
  );
  it.each([
    { mode: "metadata", albumArtist: "Curator", name: "Curator", label: "Curator" },
    { mode: "folder", albumArtist: "Curator", name: "Curator", label: "Curator" },
    { mode: "folder", albumArtist: undefined, name: "Artist", label: "Various Artists" },
  ] as const)(
    "filters compilation albums using the selected artist's matching tracks: $mode / $label",
    async ({ mode, albumArtist, name, label }) => {
      const tracks = [
        track("spring/a.mp3", "Spring A", "春"),
        track("spring/b.mp3", "Spring B", "春"),
        track("winter/a.mp3", "Winter A", "冬"),
        track("winter/b.mp3", "Winter B", "冬"),
      ];
      for (const [index, item] of tracks.entries()) {
        item.metadata = { ...item.metadata, artist: index % 2 ? "Guest" : "Artist", albumArtist };
      }
      player.setTracks(tracks);
      await useSettingsStore().setAlbumGrouping(mode);
      findButton("アーティスト").click();
      await tick();
      findButton(name).click();
      await filterLibrary("Spring A");
      const albums = () => [...root.querySelectorAll('[aria-label="関連アルバム"] li')];
      expect(albums().map((item) => item.textContent?.trim())).toEqual([`春 · ${label}`]);
      await filterLibrary("Winter B");
      // The shared album has a matching Guest track, but belongs to Artist's results
      // only when the selected artist is also its album artist.
      expect(albums().map((item) => item.textContent?.trim())).toEqual(
        albumArtist ? [`冬 · ${label}`] : [],
      );
      await filterLibrary("");
      expect(albums().map((item) => item.textContent?.trim())).toEqual([
        `春 · ${label}`,
        `冬 · ${label}`,
      ]);
    },
  );
  it("identifies untagged folder albums by file name and full path in lists and details", async () => {
    const tracks = [
      track("song.mp3", "", ""),
      track("nested/song.mp3", "", ""),
      track("nested/song.flac", "", "  "),
    ];
    for (const item of tracks) item.metadata = undefined;
    player.setTracks(tracks);
    findButton("アルバム").click();
    await tick();
    expect(root.querySelectorAll("[data-library-group]")).toHaveLength(1);
    expect(root.textContent).not.toContain("ファイル:"); // Default metadata display is unchanged.
    await useSettingsStore().setAlbumGrouping("folder");
    await tick();
    const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-library-group]")];
    expect(buttons).toHaveLength(3);
    expect(new Set(buttons.map((button) => button.dataset.libraryGroup)).size).toBe(3);
    for (const [index, button] of buttons.entries()) {
      expect(button.textContent).toContain("不明なアルバム");
      expect(button.textContent).toContain("ファイル: song");
      expect(button.textContent).toContain(tracks[index]!.path);
    }
    expect(new Set(buttons.map((button) => button.textContent)).size).toBe(3);
    buttons[1]!.click();
    await tick();
    const header = root.querySelector("#library-panel h2")!.parentElement!;
    expect(header.textContent).toContain("不明なアルバム");
    expect(header.textContent).toContain("ファイル: song");
    expect(header.textContent).toContain("nested/song.mp3");
    findButton("一覧に戻る").click();
    await filterLibrary("nested/song.flac");
    expect(root.querySelectorAll("[data-library-group]")).toHaveLength(1);
    expect(root.querySelector("[data-library-group]")?.textContent).toContain("nested/song.flac");
    await filterLibrary("");
    findButton("アーティスト").click();
    await tick();
    findButton("不明なアーティスト").click();
    await tick();
    const related = [...root.querySelectorAll('[aria-label="関連アルバム"] li')];
    expect(related).toHaveLength(3);
    expect(new Set(related.map((item) => item.textContent)).size).toBe(3);
    expect(tracks.every((item) => !item.metadata)).toBe(true);
    player.updateTrackMetadata(player.tracks[0]!, { album: "Restored", artist: "Artist" });
    await tick();
    expect(root.querySelectorAll('[aria-label="関連アルバム"] li')).toHaveLength(2);
    expect(root.querySelector('[aria-label="関連アルバム"]')?.textContent).not.toContain(
      "Restored",
    );
    findButton("アルバム").click();
    await tick();
    expect(findButton("Restored").textContent).not.toContain("ファイル:");
  });
  it("reclassifies albums, searches and artist details without changing playback", async () => {
    player.updateTrackMetadata(player.tracks[1]!, {
      title: "Second",
      album: "Two",
      artist: "Other",
    });
    await player.playAt(0);
    player.setShuffle(true);
    player.setRepeat("one");
    const source = audio.src;
    const queue = player.queue;
    const order = player.order;
    const current = player.current;
    const reset = vi.spyOn(player, "setTracks");
    findButton("アルバム").click();
    await tick();
    expect(root.querySelectorAll("[data-library-group]")).toHaveLength(3);
    findButton("Two").click();
    await tick();
    void useSettingsStore().setAlbumGrouping("folder");
    await tick();
    expect(root.textContent).not.toContain("一覧に戻る");
    expect(root.querySelectorAll("[data-library-group]")).toHaveLength(2);
    expect(root.textContent).toContain("Various Artists");
    expect(player.current).toBe(current);
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(audio.src).toBe(source);
    expect(vi.mocked(URL).createObjectURL).toHaveBeenCalledTimes(1);
    const search = root.querySelector<HTMLInputElement>("#library-search")!;
    search.value = "Second";
    search.dispatchEvent(new Event("input"));
    await tick();
    expect(root.querySelectorAll("[data-library-group]")).toHaveLength(1);
    expect(root.textContent).toContain("Various Artists");
    findButton("Two").click();
    await tick();
    expect(root.textContent).toContain("1 曲");
    findButton("Second").click();
    await vi.waitFor(() => expect(player.current?.path).toBe("two.mp3"));
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    search.value = "";
    search.dispatchEvent(new Event("input"));
    findButton("アーティスト").click();
    await tick();
    findButton("Artist").click();
    await tick();
    expect(root.textContent).toContain("Various Artists");
    void useSettingsStore().setAlbumGrouping("metadata");
    await tick();
    expect(root.textContent).toContain("一覧に戻る"); // artist keys are stable
    expect(root.textContent).not.toContain("Various Artists");
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.shuffle).toBe(true);
    expect(player.repeat).toBe("one");
    expect(player.playing).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    // Only the explicit click above changed the selected track and its audio URL.
    expect(current?.path).toBe("one.mp3");
    expect(source).toBe(audio.src);
    expect(vi.mocked(URL).createObjectURL).toHaveBeenCalledTimes(2);
  });
  it("shows the filtered count in album and artist details", async () => {
    const search = root.querySelector<HTMLInputElement>("#library-search")!;
    const count = () => root.querySelector("#library-panel h2")?.parentElement?.textContent;
    const filter = async (value: string) => {
      search.value = value;
      search.dispatchEvent(new Event("input"));
      await tick();
    };
    findButton("アルバム").click();
    await tick();
    findButton("Two").click();
    await tick();
    expect(count()).toContain("2 曲");
    await filter("Second");
    expect(count()).toContain("1 曲");
    await filter("missing");
    expect(count()).toContain("0 曲");
    expect(root.textContent).toContain("検索に一致する曲がありません");
    await filter("");
    expect(count()).toContain("2 曲");

    findButton("アーティスト").click();
    await tick();
    findButton("Artist").click();
    await tick();
    expect(count()).toContain("3 曲");
    await filter("Second");
    expect(count()).toContain("1 曲");
    await filter("missing");
    expect(count()).toContain("0 曲");
  });
  it("plays the correct library track from search and album details without rebuilding the queue", async () => {
    await player.playAt(0);
    player.setShuffle(true);
    player.setRepeat("all");
    player.addTrack(player.tracks[1]!);
    const queue = player.queue;
    const order = player.order;
    const source = audio.src;
    const search = root.querySelector<HTMLInputElement>("#library-search")!;
    search.value = "Second";
    search.dispatchEvent(new Event("input"));
    await tick();
    expect(audio.src).toBe(source);
    expect(player.queue).toBe(queue);
    findButton("Second").click();
    await vi.waitFor(() => expect(player.current?.path).toBe("two.mp3"));
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.shuffle).toBe(true);
    expect(player.repeat).toBe("all");
    search.value = "";
    search.dispatchEvent(new Event("input"));
    await tick();
    findButton("アルバム").click();
    await tick();
    const opener = findButton("Two");
    opener.focus();
    opener.click();
    await tick();
    findButton("Third").click();
    await vi.waitFor(() => expect(player.current?.path).toBe("three.mp3"));
    expect(player.queue).toBe(queue);
    expect(created).toHaveBeenCalledTimes(1);
    findButton("一覧に戻る").click();
    await tick();
    expect(document.activeElement).toBe(findButton("Two"));
    findButton("アーティスト").click();
    await tick();
    findButton("Artist").click();
    await tick();
    expect(root.textContent).toContain("One");
    expect(root.textContent).toContain("Third");
  });
  it("returns safely when metadata changes or a folder changes", async () => {
    findButton("アルバム").click();
    await tick();
    findButton("One").click();
    await tick();
    const queue = player.queue;
    player.updateTrackMetadata(player.tracks[0]!, { album: "Renamed", artist: "Artist" });
    await tick();
    expect(root.textContent).not.toContain("一覧に戻る");
    expect(root.textContent).toContain("Renamed");
    expect(player.queue).toBe(queue);
    findButton("Two").click();
    await tick();
    directory.value = { name: "two" } as MusicDirectory;
    await tick();
    expect(root.textContent).not.toContain("一覧に戻る");
  });
});
