import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createApp, h, nextTick, ref, vaporInteropPlugin } from "vue";
import { createPinia } from "pinia";
import ui from "@nuxt/ui/vue-plugin";
import LibraryBrowser from "../components/LibraryBrowser.vue";
import { usePlayerStore } from "../stores/player";
import type { MusicDirectory, Track } from "../lib/library";

const track = (path: string, title: string, album: string): Track => ({
  path,
  name: path,
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
