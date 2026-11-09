import { describe, expect, it, vi } from "vite-plus/test";
import { shallowReactive, computed } from "vue";
import type { Track } from "../lib/library";
import { buildCatalog, matchesTrack, trackTitle } from "../lib/music-catalog";

function track(path: string, metadata?: Track["metadata"]): Track {
  return { path, name: path.split("/").pop()!, metadata, handle: {} as FileSystemFileHandle };
}
describe("music catalog", () => {
  it("groups by album and album artist, falling back to track artist without key collisions", () => {
    const items = [
      track("a/1.mp3", { album: "Same", artist: "A" }),
      track("a/2.mp3", { album: "Same", artist: "A" }),
      track("b/1.mp3", { album: "Same", artist: "B" }),
      track("c/1.mp3", { album: "Mix", artist: "A", albumArtist: "Various" }),
      track("c/2.mp3", { album: "Mix", artist: "B", albumArtist: "Various" }),
      track("x.mp3", { album: "a,b", artist: "c" }),
      track("y.mp3", { album: "a", artist: "b,c" }),
    ];
    const result = buildCatalog(items);
    expect(result.albums.map((a) => a.tracks.length)).toEqual([2, 1, 2, 1, 1]);
    expect(result.artists.find((a) => a.name === "Various")?.tracks).toHaveLength(2);
    expect(result.artists.find((a) => a.name === "A")?.tracks).toHaveLength(2 + 1);
  });
  it("distinguishes missing tags from literal labels and preserves same-named paths", () => {
    const tracks = [
      track("one/song.mp3"),
      track("two/song.mp3"),
      track("three/song.mp3", { album: "不明なアルバム", artist: "不明なアーティスト" }),
    ];
    const result = buildCatalog(tracks);
    expect(result.albums).toHaveLength(2);
    expect(result.artists).toHaveLength(2);
    expect(result.albums[0]?.tracks.map((t) => t.path)).toEqual(["one/song.mp3", "two/song.mp3"]);
    expect(trackTitle(tracks[0]!)).toBe("song");
  });
  it("searches titles, artists, albums, album artists and filename fallbacks", () => {
    const t = track("folder/Song.mp3", {
      title: "夜の歌",
      artist: "Artist",
      album: "Record",
      albumArtist: "Various",
    });
    for (const query of [" 夜の歌 ", " ARTist ", "record", "various", "song"])
      expect(matchesTrack(t, query)).toBe(true);
    expect(matchesTrack(t, "missing")).toBe(false);
    expect(matchesTrack(track("x/hello.mp3"), " HELLO ")).toBe(true);
  });
  it("matches Japanese and English independently of the device locale", () => {
    const locale = vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (
      this: string,
    ) {
      return String(this).replace(/I/g, "ı").toLowerCase();
    });
    try {
      const t = track("song.mp3", { title: "INDIGO 夜", artist: "ARTIST", album: "MIX" });
      expect(matchesTrack(t, " indigo ")).toBe(true);
      expect(matchesTrack(t, "artist")).toBe(true);
      expect(matchesTrack(t, "mix")).toBe(true);
      expect(matchesTrack(t, "夜")).toBe(true);
    } finally {
      locale.mockRestore();
    }
  });
  it("reclassifies reactive metadata as it arrives", () => {
    const t = shallowReactive(track("song.mp3"));
    const catalog = computed(() => buildCatalog([t]));
    expect(catalog.value.albums[0]?.name).toBe("不明なアルバム");
    t.metadata = { album: "New", artist: "Singer" };
    expect(catalog.value.albums[0]?.name).toBe("New");
    expect(catalog.value.artists[0]?.name).toBe("Singer");
  });
});
