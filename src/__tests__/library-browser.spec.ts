import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp, h, nextTick, ref, vaporInteropPlugin } from "vue";
import { createPinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
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
let settings: ReturnType<typeof useSettingsStore>;
let audio: HTMLAudioElement;
let created: ReturnType<typeof vi.fn>;
let directory: ReturnType<typeof ref<MusicDirectory | undefined>>;
let folderPath: ReturnType<typeof ref<string>>;
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
function trackMenu(title: string) {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="「${title}」の操作"]`)!;
}
function action(dialog: HTMLDialogElement, label: string) {
  return [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  )!;
}
async function filterLibrary(value: string) {
  const search = root.querySelector<HTMLInputElement>("#library-search")!;
  search.value = value;
  search.dispatchEvent(new Event("input"));
  await tick();
}
beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
      },
    },
  });
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
  settings = useSettingsStore(pinia);
  await settings.restore();
  player.setTracks([
    track("one.mp3", "First", "One"),
    track("two.mp3", "Second", "Two"),
    track("three.mp3", "Third", "Two"),
  ]);
  directory = ref({ name: "one" } as MusicDirectory);
  folderPath = ref("");
  app = createApp({
    setup: () => () =>
      h(LibraryBrowser, {
        tracks: player.tracks,
        directory: directory.value,
        folderPath: folderPath.value,
        onNavigateFolder: (path: string) => (folderPath.value = path),
      }),
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
  it("runs actions for a filtered track without activating its row on open or enqueue", async () => {
    await player.playAt(0);
    audio.currentTime = 12;
    audio.dispatchEvent(new Event("timeupdate"));
    const { queue, order, currentId } = player;
    const source = audio.src;
    const read = vi.spyOn(player.tracks[2]!.handle, "getFile");
    await filterLibrary("Third");
    const menu = trackMenu("Third");
    expect(menu.parentElement?.querySelectorAll(":scope > button")).toHaveLength(2);
    menu.click();
    await tick();
    const dialog = root.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(action(dialog, "再生"));
    expect(
      [...dialog.querySelectorAll("button")].map((button) => button.textContent?.trim()),
    ).toEqual(["再生", "次に再生", "キューの最後に追加", "曲情報", "閉じる"]);
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    action(dialog, "次に再生").click();
    await tick();
    const inserted = player.queue[1]!;
    expect(inserted.track.path).toBe("three.mp3");
    expect(player.queue.filter((entry) => entry !== inserted)).toEqual(queue);
    expect(player.order).toEqual([order[0], inserted.id, ...order.slice(1)]);
    expect(dialog.open).toBe(false);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menu);

    menu.click();
    await tick();
    action(root.querySelector("dialog")!, "キューの最後に追加").click();
    await tick();
    const appended = player.queue[player.queue.length - 1];
    expect(appended?.track).toBe(inserted.track);
    expect(appended?.id).not.toBe(inserted.id);
    expect(player).toMatchObject({ currentId, playing: true, currentTime: 12 });
    expect(audio.src).toBe(source);
    expect(read).not.toHaveBeenCalled();

    menu.click();
    await tick();
    action(root.querySelector("dialog")!, "再生").click();
    await vi.waitFor(() => expect(player.currentId).toBe(inserted.id));
    expect(read).toHaveBeenCalledOnce();
  });

  it("shows the selected folder track's local details and restores focus on Escape", async () => {
    const selected = track("A/日本語 song.mp3", "Title", "Album");
    selected.metadata!.albumArtist = "Album Artist";
    const read = vi.spyOn(selected.handle, "getFile");
    player.setTracks([track("B/other.mp3", "Other", "Album"), selected]);
    root.querySelector<HTMLButtonElement>("#library-tab-folders")!.click();
    await tick();
    root.querySelector<HTMLButtonElement>('[data-folder-path="A"]')!.click();
    await tick();
    const menu = trackMenu("Title");
    menu.click();
    await tick();
    const dialog = root.querySelector("dialog")!;
    action(dialog, "曲情報").click();
    await tick();
    expect(document.activeElement).toBe(dialog.querySelector("h2"));
    expect([...dialog.querySelectorAll("dd")].map((item) => item.textContent)).toEqual([
      "Title",
      "Artist",
      "Album",
      "Album Artist",
      "日本語 song.mp3",
      "A/日本語 song.mp3",
    ]);
    const cancel = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(cancel);
    await tick();
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(menu);
    expect(folderPath.value).toBe("A");
    expect(player.currentId).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it.each(["removed", "different root"])("discards a menu when its track is %s", async (change) => {
    trackMenu("Second").click();
    await tick();
    const dialog = root.querySelector("dialog")!;
    const replacement = track("two.mp3", "Different", "Two");
    const read = vi.spyOn(replacement.handle, "getFile");
    if (change === "removed") player.updateTracks([player.tracks[0]!]);
    else player.setTracks([replacement]);
    const { queue } = player;
    // A click delivered before the UI refresh still has to validate the selected track.
    action(dialog, "キューの最後に追加").click();
    await tick();
    expect(dialog.open).toBe(false);
    expect(player.queue).toBe(queue);
    expect(player.currentId).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("browses only the current folder and matching branches with the shared track sort and playback", async () => {
    const rootTrack = track("root.mp3", "Root", "Library");
    const untagged = track("Vol2/同じ/song.mp3", "", "");
    untagged.metadata = undefined;
    player.setTracks([
      rootTrack,
      track("Vol10/同じ/song.mp3", "Other volume", "Library"),
      track("Vol2/同じ/ten.mp3", "Song10", "Library"),
      track("Vol2/同じ/two.mp3", "Song2", "Library"),
      untagged,
    ]);
    await player.playAt(0);
    player.addTrack(player.tracks[1]!);
    player.setShuffle(true);
    player.setRepeat("all");
    audio.currentTime = 25;
    audio.dispatchEvent(new Event("timeupdate"));
    const { queue, order, current, currentId } = player;
    const source = audio.src;
    const readFile = vi.spyOn(untagged.handle, "getFile");
    const folderButtons = () => [...root.querySelectorAll<HTMLButtonElement>("[data-folder-path]")];
    const titles = () =>
      [...root.querySelectorAll('[aria-label="曲一覧"] li .min-w-0 > .font-medium')].map(
        (item) => item.textContent,
      );
    const folderTab = root.querySelector<HTMLButtonElement>("#library-tab-folders")!;
    const artistTab = root.querySelector<HTMLButtonElement>("#library-tab-artists")!;
    artistTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await tick();
    expect(document.activeElement).toBe(folderTab);
    expect(folderButtons().map((button) => button.dataset.folderPath)).toEqual(["Vol2", "Vol10"]);
    expect(titles()).toEqual(["Root"]);

    await filterLibrary("Song2");
    expect(folderButtons().map((button) => button.dataset.folderPath)).toEqual(["Vol2"]);
    expect(titles()).toEqual([]);
    folderButtons()[0]!.focus();
    folderButtons()[0]!.click();
    await tick();
    expect(document.activeElement?.textContent).toBe("Vol2");
    folderButtons()[0]!.focus();
    folderButtons()[0]!.click();
    await tick();
    expect(titles()).toEqual(["Song2"]);
    expect(root.querySelectorAll('[aria-label="フォルダーの階層"] li')).toHaveLength(3);

    await filterLibrary("missing");
    expect(titles()).toEqual([]);
    expect(root.textContent).toContain("検索に一致する曲がありません。");
    root.querySelector<HTMLButtonElement>('button[aria-label="検索をクリア"]')!.click();
    await tick();
    expect(document.activeElement?.id).toBe("library-search");
    await settings.setSortKey("tracks", "title");
    await tick();
    expect(folderPath.value).toBe("Vol2/同じ");
    expect(titles()).toEqual(["song", "Song2", "Song10"]);
    const up = findButton("上の階層へ");
    up.focus();
    up.click();
    await tick();
    expect(document.activeElement).toBe(folderButtons()[0]);
    folderButtons()[0]!.click();
    await tick();

    artistTab.click();
    await tick();
    folderTab.click();
    await tick();
    expect(folderPath.value).toBe("");
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.current).toBe(current);
    expect(player.currentId).toBe(currentId);
    expect(player.currentTime).toBe(25);
    expect(player.playing).toBe(true);
    expect(audio.src).toBe(source);
    expect(readFile).not.toHaveBeenCalled();
    await filterLibrary("Vol2/同じ/song.mp3");
    folderButtons()[0]!.click();
    await tick();
    folderButtons()[0]!.click();
    await tick();
    findButton("song").click();
    await vi.waitFor(() => expect(player.current?.path).toBe("Vol2/同じ/song.mp3"));
    expect(readFile).toHaveBeenCalledOnce();
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
  });

  it("keeps the folder on tag changes and refresh, then falls back to the closest remaining folder", async () => {
    const music = [
      track("A/B/C/one.mp3", "First", "Album"),
      track("A/second.mp3", "Second", "Album"),
    ];
    player.setTracks(music);
    root.querySelector<HTMLButtonElement>("#library-tab-folders")!.click();
    await tick();
    for (const path of ["A", "A/B", "A/B/C"]) {
      root.querySelector<HTMLButtonElement>(`[data-folder-path="${path}"]`)!.click();
      await tick();
    }
    player.updateTrackMetadata(player.tracks[0]!, { title: "Renamed" });
    await tick();
    expect(folderPath.value).toBe("A/B/C");
    expect(findButton("Renamed")).toBeDefined();
    player.updateTracks([...music, track("new.mp3", "New", "Album")]);
    await tick();
    expect(folderPath.value).toBe("A/B/C");
    player.updateTracks(music.slice(1));
    await tick();
    expect(folderPath.value).toBe("A");
    expect(root.querySelector('[aria-current="location"]')?.textContent).toBe("A");
    expect(findButton("Second")).toBeDefined();
    player.updateTracks([]);
    await tick();
    expect(folderPath.value).toBe("");
  });

  it.each([
    { mode: "metadata", repeat: "one", albumRepeat: "off" },
    { mode: "folder", repeat: "all", albumRepeat: "all" },
  ] as const)(
    "keeps recording order through search and replaces the queue only on album play in $mode mode",
    async ({ mode, repeat, albumRepeat }) => {
      const otherDisc = track("album/z.mp3", "Match Z", "Record");
      otherDisc.metadata!.discNumber = 2;
      const firstDisc = track("album/a.mp3", "Match A", "Record");
      const second = track("album/b.mp3", "Second", "Record");
      Object.assign(second.metadata!, { discNumber: 2, trackNumber: 1 });
      const first = track("album/c.mp3", "First", "Record");
      first.metadata!.trackNumber = 2;
      const unrelated = track("other/c.mp3", "Other", "Record");
      Object.assign(unrelated.metadata!, { artist: "Other Artist", discNumber: 1, trackNumber: 1 });
      const music = [otherDisc, firstDisc, second, first, unrelated];
      player.setTracks(music);
      await player.restorePlayback("root");
      await settings.setAlbumGrouping(mode);
      await settings.setSortKey("tracks", "artist");
      await player.playAt(4);
      player.setShuffle(true);
      player.setRepeat(repeat);
      player.setVolume(0.4);
      audio.currentTime = 25;
      audio.dispatchEvent(new Event("timeupdate"));
      const { current, queue, order, currentId } = player;
      const source = audio.src;

      root.querySelector<HTMLButtonElement>("#library-tab-albums")!.click();
      await tick();
      expect(root.querySelectorAll("[data-library-group]")).toHaveLength(2);
      findButton("Record").click();
      await tick();
      const discTitles = () =>
        [...root.querySelectorAll("h4")].map((item) => item.textContent?.trim());
      const titles = () =>
        [...root.querySelectorAll('[aria-label="曲一覧"] li .min-w-0 > .font-medium')].map(
          (item) => item.textContent,
        );
      const sort = root.querySelector<HTMLSelectElement>("#library-panel select")!;
      expect(sort.value).toBe("recording");
      expect(discTitles()).toEqual(["Disc 1", "Disc 2"]);
      expect(titles()).toEqual(["First", "Match A", "Second", "Match Z"]);

      await filterLibrary("Match");
      expect(titles()).toEqual(["Match A", "Match Z"]);
      await filterLibrary("Match Z");
      expect(discTitles()).toEqual(["Disc 2"]);
      expect(titles()).toEqual(["Match Z"]);
      await filterLibrary("Match");
      sort.value = "title";
      sort.dispatchEvent(new Event("change"));
      await tick();
      const direction = root.querySelectorAll<HTMLSelectElement>("#library-panel select")[1]!;
      direction.value = "desc";
      direction.dispatchEvent(new Event("change"));
      await tick();
      expect(discTitles()).toEqual([]);
      expect(titles()).toEqual(["Match Z", "Match A"]);
      expect(settings.librarySort.tracks).toEqual({ key: "artist", direction: "asc" });
      expect(player.current).toBe(current);
      expect(player.currentId).toBe(currentId);
      expect(player.queue).toBe(queue);
      expect(player.order).toBe(order);
      expect(player.currentTime).toBe(25);
      expect(audio.src).toBe(source);

      findButton("Match A").click();
      await vi.waitFor(() => expect(player.index).toBe(1));
      expect(player.queue).toBe(queue);
      expect(player.order).toBe(order);
      expect(player.repeat).toBe(repeat);

      const playAlbum = findButton("アルバムを再生");
      const description = document.getElementById(playAlbum.getAttribute("aria-describedby")!);
      expect(description?.textContent).toContain("現在のキューを置き換え、アルバム全 4 曲");
      expect(description?.textContent).toContain("シャッフルを解除します");
      expect(description?.textContent?.includes("1曲リピートを解除します")).toBe(repeat === "one");
      playAlbum.click();
      await vi.waitFor(() => expect(player.playing).toBe(true));
      const recordingOrder = [first.path, firstDisc.path, second.path, otherDisc.path];
      expect(player.queue.map(({ track }) => track.path)).toEqual(recordingOrder);
      expect(player.order).toEqual(player.queue.map(({ id }) => id));
      expect(player.current?.path).toBe(first.path);
      expect(player.shuffle).toBe(false);
      expect(player.repeat).toBe(albumRepeat);
      expect(player.volume).toBe(0.4);

      await player.flushPlayback();
      player.setTracks(music);
      await player.restorePlayback("root");
      expect(player.queue.map(({ track }) => track.path)).toEqual(recordingOrder);
      expect(player.current?.path).toBe(first.path);
      expect(player.playing).toBe(false);
      expect(player.repeat).toBe(albumRepeat);
    },
  );

  it.each(["metadata", "folder"] as const)(
    "updates each filtered view and open details without changing playback in %s mode",
    async (mode) => {
      const music = [
        track("a/ten.mp3", "Song10", "Record10"),
        track("a/two.mp3", "Song2", "Record10"),
        track("b/one.mp3", "Song1", "Record2"),
        track("b/other.mp3", "Unmatched", "Record2"),
      ];
      music[0]!.metadata!.artist = "Artist10";
      music[1]!.metadata!.artist = "Artist10";
      music[2]!.metadata!.artist = "Artist2";
      music[3]!.metadata!.artist = "Artist2";
      player.setTracks(music);
      await settings.setAlbumGrouping(mode);
      await player.playAt(0);
      player.addTrack(player.tracks[1]!);
      player.setShuffle(true);
      player.setRepeat("one");
      audio.currentTime = 25;
      audio.dispatchEvent(new Event("timeupdate"));
      const { tracks, queue, order, current, currentId } = player;
      const source = audio.src;
      await filterLibrary("Song");
      const titles = () =>
        [...root.querySelectorAll('[aria-label="曲一覧"] li .min-w-0 > .font-medium')].map(
          (item) => item.textContent,
        );
      const groups = () =>
        [...root.querySelectorAll("[data-library-group] .font-semibold")].map(
          (item) => item.textContent,
        );
      expect(titles()).toEqual(["Song10", "Song2", "Song1"]);
      const saveTrackSort = settings.setSortKey("tracks", "title");
      await tick();
      expect(titles()).toEqual(["Song1", "Song2", "Song10"]);
      expect(root.querySelector('[aria-current="true"]')?.textContent).toContain("Song10");
      await saveTrackSort;

      findButton("アルバム").click();
      await tick();
      expect(groups()).toEqual(["Record10", "Record2"]);
      void settings.setSortKey("albums", "album");
      await tick();
      expect(groups()).toEqual(["Record2", "Record10"]);
      findButton("Record10").click();
      await tick();
      expect(titles()).toEqual(["Song10", "Song2"]);
      void settings.setSortDirection("tracks", "desc");
      await tick();
      expect(root.querySelector("#library-panel h2")?.textContent).toBe("Record10");
      expect(titles()).toEqual(["Song10", "Song2"]);

      findButton("アーティスト").click();
      await tick();
      expect(groups()).toEqual(["Artist10", "Artist2"]);
      void settings.setSortKey("artists", "artist");
      await tick();
      expect(groups()).toEqual(["Artist2", "Artist10"]);
      findButton("Artist10").click();
      await tick();
      await settings.setSortDirection("tracks", "asc");
      await tick();
      expect(root.querySelector("#library-panel h2")?.textContent).toBe("Artist10");
      expect(titles()).toEqual(["Song2", "Song10"]);
      expect(root.querySelector<HTMLInputElement>("#library-search")?.value).toBe("Song");
      expect(root.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe(
        "library-tab-artists",
      );
      expect(player.tracks).toBe(tracks);
      expect(player.queue).toBe(queue);
      expect(player.order).toBe(order);
      expect(player.current).toBe(current);
      expect(player.currentId).toBe(currentId);
      expect(player.currentTime).toBe(25);
      expect(player.playing).toBe(true);
      expect(player.shuffle).toBe(true);
      expect(player.repeat).toBe("one");
      expect(audio.src).toBe(source);
      expect(vi.mocked(URL).createObjectURL).toHaveBeenCalledTimes(1);

      findButton("Song2").click();
      await vi.waitFor(() => expect(player.current?.path).toBe("a/two.mp3"));
      expect(player.queue).toBe(queue);
      expect(player.order).toBe(order);
      expect(created).toHaveBeenCalledTimes(1);
    },
  );
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
