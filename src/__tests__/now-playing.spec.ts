import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp, nextTick, vaporInteropPlugin } from "vue";
import { IDBFactory } from "fake-indexeddb";
import { useSettingsStore } from "../stores/settings";
import { createPinia } from "pinia";
import ui from "@nuxt/ui/vue-plugin";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { usePlayerStore } from "../stores/player";
import { useLibraryStore } from "../stores/library";
import { createNowPlayingHistory } from "../lib/now-playing-history";
import type { Track } from "../lib/library";

function track(name: string): Track {
  return {
    name,
    path: name,
    handle: { getFile: async () => new File(["audio"], name) } as FileSystemFileHandle,
  };
}
let root: HTMLElement;
let app: ReturnType<typeof createApp>;
let mounted: boolean;
let player: ReturnType<typeof usePlayerStore>;
let audio: HTMLAudioElement;
let created: ReturnType<typeof vi.fn>;
let createUrl: ReturnType<typeof vi.fn>;
let systemScheme: EventTarget;
let systemDark: boolean;
function button(label: string, within: ParentNode = root) {
  const found = within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function tick() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}
beforeEach(() => {
  history.replaceState({}, "", "/");
  localStorage.clear();
  systemDark = false;
  systemScheme = new EventTarget();
  Object.defineProperty(systemScheme, "matches", { get: () => systemDark });
  vi.stubGlobal("matchMedia", () => systemScheme);
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { configurable: true, value: false });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  created = vi.fn(function () {
    audio = document.createElement("audio");
    return audio;
  });
  vi.stubGlobal("Audio", created);
  createUrl = vi.fn().mockReturnValue("blob:audio");
  URL.createObjectURL = createUrl as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  root = document.createElement("div");
  document.body.append(root);
  const pinia = createPinia();
  app = createApp(App)
    .use(vaporInteropPlugin)
    .use(pinia)
    .use(createRouter({ history: createMemoryHistory(), routes: [] }))
    .use(ui);
  app.mount(root);
  mounted = true;
  player = usePlayerStore(pinia);
});
afterEach(() => {
  if (mounted) app.unmount();
  player.$dispose();
  root.remove();
  document.documentElement.classList.remove("dark");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Now Playing", () => {
  it("applies system and fixed themes to the open settings and dialog without changing playback or history", async () => {
    const settings = useSettingsStore();
    await settings.restore();
    expect(settings.theme).toBe("system");
    const html = document.documentElement;
    const changeSystem = (dark: boolean) => {
      systemDark = dark;
      systemScheme.dispatchEvent(new Event("change"));
    };
    expect(html.classList.contains("dark")).toBe(false);
    changeSystem(true);
    expect(html.classList.contains("dark")).toBe(true);
    changeSystem(false);
    expect(html.classList.contains("dark")).toBe(false);

    player.setTracks([track("first.mp3")]);
    await player.playAt(0);
    const { current, queue, order } = player;
    const source = audio.src;
    button("設定を開く").click();
    await tick();
    const settingsMain = root.querySelector("main[aria-labelledby='settings-title']")!;
    const option = (theme: string) =>
      settingsMain.querySelector<HTMLInputElement>(`input[name="theme"][value="${theme}"]`)!;
    const settingEntry = history.state;
    expect(option("system").checked).toBe(true);
    option("dark").click();
    await tick();
    expect(html.classList.contains("dark")).toBe(true);
    expect(option("dark").checked).toBe(true);
    expect(history.state).toEqual(settingEntry);
    changeSystem(true);
    changeSystem(false);
    expect(html.classList.contains("dark")).toBe(true);

    option("light").click();
    await tick();
    expect(html.classList.contains("dark")).toBe(false);
    changeSystem(true);
    expect(html.classList.contains("dark")).toBe(false);
    button("再生中の画面を開く").click();
    await tick();
    const dialog = root.querySelector("dialog")!;
    const dialogEntry = history.state;
    const historyLength = history.length;
    expect(dialog.open).toBe(true);
    await settings.setTheme("system");
    await tick();
    expect(html.classList.contains("dark")).toBe(true);
    expect(option("system").checked).toBe(true);
    expect(html.contains(dialog)).toBe(true);
    expect(root.querySelector("dialog")).toBe(dialog);
    expect(dialog.open).toBe(true);
    expect(history.state).toEqual(dialogEntry);
    expect(history.length).toBe(historyLength);
    expect(player.current).toBe(current);
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.playing).toBe(true);
    expect(audio.src).toBe(source);
    expect(created).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps the live player and library mounted through settings, mode changes and Android Back", async () => {
    const library = useLibraryStore();
    const settings = useSettingsStore();
    await settings.restore();
    const a = track("mix/a.mp3");
    const b = track("mix/b.mp3");
    a.metadata = { title: "First", album: "Mix", artist: "A" };
    b.metadata = { title: "Second", album: "Mix", artist: "B" };
    player.setTracks([a, b]);
    await player.playAt(0);
    player.setShuffle(true);
    player.setRepeat("all");
    Object.defineProperty(audio, "duration", { configurable: true, value: 100 });
    audio.currentTime = 25;
    audio.dispatchEvent(new Event("timeupdate"));
    await tick();
    const reset = vi.spyOn(player, "setTracks");
    const analyze = vi.spyOn(library, "analyze");
    const scan = vi.spyOn(library, "refresh");
    const file = vi.spyOn(a.handle, "getFile");
    const source = audio.src;
    const queue = player.queue;
    const order = player.order;
    const current = player.current;
    const libraryMain = root.querySelector("main")!;
    const miniPlayer = root.querySelector("footer")!;
    const search = root.querySelector<HTMLInputElement>("#library-search")!;
    root.querySelector<HTMLButtonElement>("#library-tab-albums")!.click();
    await tick();
    root.querySelector<HTMLButtonElement>("[data-library-group]")!.click();
    await tick();
    button("設定を開く").focus();
    button("設定を開く").click();
    await tick();
    expect(root.querySelector("main")).toBe(libraryMain);
    expect(libraryMain.style.display).toBe("none");
    expect(root.querySelector("footer")).toBe(miniPlayer);
    expect(document.activeElement?.id).toBe("settings-title");
    expect(root.querySelector<HTMLInputElement>('input[value="metadata"]')!.checked).toBe(true);
    root.querySelector<HTMLInputElement>('input[value="folder"]')!.click();
    await vi.waitFor(() => expect(settings.saving).toBe(false));
    await tick();
    expect(settings.albumGrouping).toBe("folder");
    expect(player.current).toBe(current);
    expect(player.queue).toBe(queue);
    expect(player.order).toBe(order);
    expect(player.playing).toBe(true);
    expect(player.currentTime).toBe(25);
    expect(player.shuffle).toBe(true);
    expect(player.repeat).toBe("all");
    expect(audio.src).toBe(source);
    expect(created).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
    button("再生中の画面を開く").focus();
    button("再生中の画面を開く").click();
    await tick();
    expect(root.querySelector("dialog")!.open).toBe(true);
    history.back(); // Android Back dismisses only Now Playing
    await vi.waitFor(() => expect(root.querySelector("dialog")!.open).toBe(false));
    expect(root.querySelector("#settings-title")).not.toBeNull();
    expect(document.activeElement).toBe(button("再生中の画面を開く"));
    history.back(); // next Back returns to the existing library
    await vi.waitFor(() => expect(root.querySelector("#settings-title")).toBeNull());
    await tick();
    expect(document.activeElement).toBe(button("設定を開く"));
    expect(libraryMain.style.display).toBe("");
    expect(root.querySelector("#library-search")).toBe(search);
    expect(root.textContent).not.toContain("一覧に戻る"); // obsolete metadata album key
    expect(root.textContent).toContain("Various Artists");
    expect(player.queue).toBe(queue);
    expect(player.playing).toBe(true);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });
  it("returns with the settings back button and shows a retry after a failed save", async () => {
    const settings = useSettingsStore();
    await settings.restore();
    button("設定を開く").click();
    await tick();
    vi.stubGlobal("indexedDB", undefined);
    root.querySelector<HTMLInputElement>('input[value="folder"]')!.click();
    await vi.waitFor(() => expect(settings.saveFailed).toBe(true));
    await tick();
    expect(root.textContent).toContain("今回のみ有効");
    const retry = [...root.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("保存を再試行"),
    )!;
    vi.stubGlobal("indexedDB", new IDBFactory());
    retry.click();
    await vi.waitFor(() => expect(settings.status).toBe("設定を保存しました。"));
    const back = [...root.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("ライブラリに戻る"),
    )!;
    back.click();
    await vi.waitFor(() => expect(history.state.__offtoneView).toBeUndefined());
    await tick();
    expect(root.querySelector("#settings-title")).toBeNull();
    expect(document.activeElement).toBe(button("設定を開く"));
  });
  it("labels the folder count as the total when the track list is filtered", async () => {
    const library = useLibraryStore();
    library.folderName = "Music";
    player.setTracks([track("first.mp3"), track("second.mp3")]);
    await tick();
    const search = root.querySelector<HTMLInputElement>("#library-search")!;
    search.value = "second";
    search.dispatchEvent(new Event("input"));
    await tick();
    expect(root.textContent).toMatch(/Music\s+· 全 2 曲/);
    expect(root.querySelectorAll('[aria-label="曲一覧"] li')).toHaveLength(1);
    expect(root.querySelector('[aria-label="曲一覧"]')?.textContent).toContain("second");
  });
  it("announces analysis lifecycle without announcing each progress update", async () => {
    const library = useLibraryStore();
    const status = root.querySelector('[role="status"][aria-label="タグ解析の状態"]')!;
    expect(status.textContent?.trim()).toBe("");
    library.analysis = { active: true, done: 0, total: 3 };
    await tick();
    expect(status.textContent).toContain("タグ解析を開始しました");
    const onMutation = vi.fn();
    const observer = new MutationObserver(onMutation);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    library.analysis = { active: true, done: 1, total: 3 };
    await tick();
    expect(observer.takeRecords()).toHaveLength(0);
    expect(onMutation).not.toHaveBeenCalled();
    expect(root.textContent).toContain("タグを解析中 1 / 3");
    library.analysis = { active: false, done: 3, total: 3 };
    await tick();
    expect(status.textContent).toContain("タグ解析が終了しました");
    library.analysis = { active: true, done: 0, total: 3 };
    library.analysisCancelled = false;
    await tick();
    library.analysis = { active: false, done: 1, total: 3 };
    library.analysisCancelled = true;
    await tick();
    expect(status.textContent).toContain("タグ解析をキャンセルしました");
    observer.disconnect();
  });
  it("restores scrolling when the app is unmounted while the dialog is open", async () => {
    button("再生中の画面を開く").click();
    await tick();
    expect(document.body.style.overflow).toBe("hidden");
    app.unmount();
    mounted = false;
    expect(document.body.style.overflow).toBe("");
  });

  it("exposes the current title and playback position without announcing every time update", async () => {
    const footer = root.querySelector("footer")!;
    const title = footer.querySelector('[aria-live="polite"]')!;
    const progress = footer.querySelector('[role="progressbar"]')!;
    const opener = button("再生中の画面を開く");
    expect(title.textContent).toContain("曲が選択されていません");
    expect(opener.getAttribute("aria-describedby")).toBe("mini-player-title");
    expect(progress.getAttribute("aria-valuetext")).toBe("再生時間は不明です");
    expect(progress.hasAttribute("aria-valuenow")).toBe(false);
    expect(progress.closest("[aria-live]")).toBeNull();

    player.setTracks([track("first.mp3"), track("second.mp3")]);
    await player.playAt(0);
    Object.defineProperty(audio!, "duration", { configurable: true, value: 100 });
    audio!.currentTime = 25;
    audio!.dispatchEvent(new Event("timeupdate"));
    await tick();
    expect(title.textContent).toContain("first");
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuetext")).toBe("0:25 / 1:40");

    player.updateTrackMetadata(player.current!, { title: "Tagged", artist: "Artist" });
    await tick();
    expect(title.textContent).toContain("Tagged");
    expect(opener.getAttribute("aria-describedby")).toBe("mini-player-title mini-player-artist");
    await player.playAt(1);
    await tick();
    expect(title.textContent).toContain("second");
  });

  it("keeps the queue accessible before a track is selected", async () => {
    player.setTracks([track("first.mp3"), track("second.mp3")]);
    await tick();
    expect(player.current).toBeUndefined();
    button("再生中の画面を開く").click();
    await tick();
    expect(root.querySelector("dialog")!.open).toBe(true);
    root.querySelector<HTMLElement>("dialog summary")!.click();
    expect(root.querySelector<HTMLDetailsElement>("dialog details")!.open).toBe(true);
    button("second.mp3 を上へ").click();
    expect(player.queue.map((entry) => entry.track.name)).toEqual(["second.mp3", "first.mp3"]);
    expect(player.current).toBeUndefined();
  });

  it("opens and closes with focus restoration without replacing playback or queue", async () => {
    player.setTracks([track("first.mp3"), track("second.mp3")]);
    await player.playAt(0);
    Object.defineProperty(audio!, "duration", { configurable: true, value: 100 });
    audio!.currentTime = 25;
    audio!.dispatchEvent(new Event("timeupdate"));
    const queue = player.queue;
    const id = player.currentId;
    const source = audio!.src;
    const opener = button("再生中の画面を開く");
    opener.focus();
    opener.click();
    await tick();
    const dialog = root.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(button("再生中の画面を閉じる"));
    expect(document.body.style.overflow).toBe("hidden");
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    await tick();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
    expect(player.playing).toBe(true);
    expect(player.currentTime).toBe(25);
    expect(player.currentId).toBe(id);
    expect(player.queue).toBe(queue);
    expect(audio!.src).toBe(source);
    expect(created).toHaveBeenCalledTimes(1);
  });
  it("returns to an open album detail after the Now Playing dialog closes", async () => {
    const tagged = track("album.mp3");
    tagged.metadata = { title: "Album song", album: "Album name", artist: "Artist" };
    player.setTracks([tagged]);
    await player.playAt(0);
    await tick();
    const albumTab = root.querySelector<HTMLButtonElement>('[role="tab"]:nth-child(2)')!;
    albumTab.click();
    await tick();
    const albumButton = [...root.querySelectorAll<HTMLButtonElement>("[data-library-group]")][0]!;
    albumButton.click();
    await tick();
    expect(root.textContent).toContain("一覧に戻る");
    const source = audio.src;
    const queue = player.queue;
    button("再生中の画面を開く").click();
    await tick();
    root.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    await tick();
    expect(root.textContent).toContain("一覧に戻る");
    expect(player.queue).toBe(queue);
    expect(audio.src).toBe(source);
    expect(created).toHaveBeenCalledTimes(1);
  });
  it("keeps play separate and reflects metadata, artwork, tracks and controls", async () => {
    player.setTracks([track("first.mp3"), track("second.mp3")]);
    await tick();
    await vi.waitFor(() => expect(button("再生").disabled).toBe(false));
    button("再生").click();
    await vi.waitFor(() => expect(player.playing).toBe(true));
    expect(root.querySelector("dialog")!.open).toBe(false);
    expect(root.textContent).toContain("first");
    button("再生中の画面を開く").click();
    await tick();
    player.updateTrackMetadata(
      player.current!,
      { title: "Tagged", artist: "Artist", album: "Album" },
      "blob:cover",
    );
    await tick();
    expect(root.querySelector("footer")?.textContent).toContain("Tagged");
    expect(root.querySelector("dialog")?.textContent).toContain("Tagged");
    expect(root.querySelector("footer img")?.getAttribute("src")).toBe("blob:cover");
    expect(root.querySelector("dialog img")?.getAttribute("src")).toBe("blob:cover");
    expect(createUrl).toHaveBeenCalledTimes(1);
    button("シャッフル").click();
    button("リピート: オフ").click();
    expect(player.shuffle).toBe(true);
    expect(player.repeat).toBe("all");
    Object.defineProperty(audio!, "duration", { configurable: true, value: 100 });
    audio!.dispatchEvent(new Event("durationchange"));
    await tick();
    const seek = root.querySelector<HTMLInputElement>('input[aria-label="再生位置"]')!;
    seek.value = "42";
    seek.dispatchEvent(new Event("input"));
    expect(player.currentTime).toBe(42);
    await player.playAt(1);
    await tick();
    expect(root.textContent).toContain("second");
    expect(root.querySelector("footer img")).toBeNull();
    expect(root.querySelector("dialog img")).toBeNull();
  });
});

describe("temporary history entry", () => {
  it("does not navigate twice when close and Back race, and ignores stale forward entries", () => {
    const listeners = new Map<string, EventListener>();
    let state: Record<string, unknown> = { existing: 1 };
    const back = vi.fn();
    const browser = {
      history: {
        get state() {
          return state;
        },
        pushState: (next: typeof state) => {
          state = next;
        },
        replaceState: (next: typeof state) => {
          state = next;
        },
        back,
      },
      addEventListener: (name: string, cb: EventListener) => listeners.set(name, cb),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const setOpen = vi.fn();
    const controller = createNowPlayingHistory(browser, setOpen);
    controller.open();
    const temporary = state;
    controller.close();
    controller.close();
    controller.open();
    expect(back).toHaveBeenCalledTimes(1);
    state = { existing: 1 };
    listeners.get("popstate")!(new Event("popstate"));
    expect(setOpen.mock.calls).toEqual([[true], [false]]);
    state = temporary;
    listeners.get("popstate")!(new Event("popstate"));
    expect(state).toEqual({ existing: 1 });
    controller.open();
    state = { existing: 1 };
    listeners.get("popstate")!(new Event("popstate"));
    controller.close();
    expect(back).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
