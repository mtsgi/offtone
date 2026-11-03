import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp, nextTick, vaporInteropPlugin } from "vue";
import { createPinia } from "pinia";
import ui from "@nuxt/ui/vue-plugin";
import { createRouter, createMemoryHistory } from "vue-router";
import App from "../App.vue";
import { usePlayerStore } from "../stores/player";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Now Playing", () => {
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
    listeners.get("popstate")!(new Event("popstate"));
    controller.close();
    expect(back).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});
