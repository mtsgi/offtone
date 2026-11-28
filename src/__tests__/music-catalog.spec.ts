import { describe, expect, it, vi } from "vite-plus/test";
import { shallowReactive, computed } from "vue";
import type { Track } from "../lib/library";
import {
  albumKey,
  buildCatalog,
  matchesTrack,
  sortByRecordingOrder,
  trackTitle,
} from "../lib/music-catalog";

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

describe("album recording order", () => {
  it("sorts by disc and track, keeping input order for repeated and missing numbers", () => {
    const discTwo = track("disc-two.mp3", { discNumber: 2, trackNumber: 1 });
    const second = track("second.mp3", { discNumber: 1, trackNumber: 2 });
    const first = track("first.mp3", { trackNumber: 1 });
    const duplicate = track("duplicate.mp3", { discNumber: 1, trackNumber: 1 });
    const missingOne = track("unknown.mp3");
    const alsoMissingOne = track("also-unknown.mp3", { discNumber: 1 });
    const missingTwo = track("unknown-two.mp3", { discNumber: 2 });
    const album = [discTwo, missingOne, second, first, missingTwo, duplicate, alsoMissingOne];
    expect(sortByRecordingOrder(album)).toEqual([
      first,
      duplicate,
      second,
      missingOne,
      alsoMissingOne,
      discTwo,
      missingTwo,
    ]);
    expect(album[0]).toBe(discTwo);
    expect(album[1]).toBe(missingOne);
  });

  it("preserves library order for albums with disc numbers alone", () => {
    const tracks = [track("two.mp3", { discNumber: 2 }), track("one.mp3", { discNumber: 1 })];
    expect(sortByRecordingOrder(tracks)).toEqual(tracks);
  });
});

const folder = { albumGrouping: "folder" } as const;
describe("folder album grouping", () => {
  it("adds file identification only to untagged folder groups without changing names or keys", () => {
    const tracks = [
      track("song.mp3"),
      track("nested/song.mp3", { title: "Tagged title" }),
      track("nested/song.flac", { album: "  " }),
      track("nested/tagged.mp3", { album: "不明なアルバム" }),
    ];
    const before = structuredClone(tracks);
    const albums = buildCatalog(tracks, folder).albums;
    expect(albums.slice(0, 3).map((album) => album.sourceFile)).toEqual([
      { name: "song", path: "song.mp3" },
      { name: "song", path: "nested/song.mp3" },
      { name: "song", path: "nested/song.flac" },
    ]);
    expect(albums.every((album) => album.name === "不明なアルバム")).toBe(true);
    for (const item of tracks.slice(0, 3))
      expect(albumKey(item, folder)).toBe(JSON.stringify(["folder-track", item.path]));
    expect(new Set(albums.map((album) => album.key)).size).toBe(4);
    expect(albums[3]?.sourceFile).toBeUndefined(); // A literal album tag is not missing.
    expect(buildCatalog(tracks).albums.every((album) => !album.sourceFile)).toBe(true);
    expect(tracks).toEqual(before);
  });
  it("merges compilations without album artists only within the same parent and album", () => {
    const tracks = [
      track("mix/a.mp3", { album: " Mix ", artist: "A" }),
      track("mix/b.mp3", { album: "Mix", artist: "B" }),
      track("other/a.mp3", { album: "Mix", artist: "A" }),
      track("mix/c.mp3", { album: "Other", artist: "A" }),
    ];
    const before = structuredClone(tracks.map(({ metadata, path }) => ({ metadata, path })));
    expect(buildCatalog(tracks).albums.map((album) => album.tracks.length)).toEqual([2, 1, 1]);
    expect(buildCatalog(tracks, { albumGrouping: "metadata" })).toEqual(buildCatalog(tracks));
    const result = buildCatalog(tracks, folder);
    expect(result.albums.map((a) => a.tracks.length)).toEqual([2, 1, 1]);
    expect(result.albums[0]?.artist).toBe("Various Artists");
    expect(result.artists.find((a) => a.name === "B")?.albums[0]).toBe(result.albums[0]);
    expect(tracks.map(({ metadata, path }) => ({ metadata, path }))).toEqual(before);
  });
  it("uses a shared album artist for display without using it as a folder key", () => {
    const result = buildCatalog(
      [
        track("a.mp3", { album: "Mix", albumArtist: "Curator", artist: "A" }),
        track("b.mp3", { album: "Mix", albumArtist: "Curator", artist: "B" }),
      ],
      folder,
    );
    expect(result.albums).toHaveLength(1);
    expect(result.albums[0]?.artist).toBe("Curator");
  });
  it("isolates absent or blank albums per full path, including root files and duplicate names", () => {
    const tracks = [
      track("song.mp3"),
      track("other.mp3", { album: "  " }),
      track("a/song.mp3"),
      track("b/song.mp3"),
      track("a/other.mp3"),
      track("a/tagged.mp3", { album: "不明なアルバム" }),
    ];
    const result = buildCatalog(tracks, folder);
    expect(result.albums).toHaveLength(tracks.length);
    expect(new Set(result.albums.map((a) => a.key)).size).toBe(tracks.length);
    expect(result.albums.every((a) => a.tracks.length === 1)).toBe(true);
  });
  it("handles root albums and preserves case, whitespace, literal backslashes and tuple boundaries", () => {
    const tracks = [
      track("one.mp3", { album: "Root" }),
      track("two.mp3", { album: "Root" }),
      ...["a", "A", " a", "a ", "a/b", "a\\b"].map((path) =>
        track(`${path}/song.mp3`, { album: "Root" }),
      ),
      track("a,b/song.mp3", { album: "c" }),
      track("a/song.mp3", { album: "b,c" }),
    ];
    const result = buildCatalog(tracks, folder);
    expect(result.albums).toHaveLength(tracks.length - 1);
    expect(result.albums[0]?.tracks).toHaveLength(2);
  });
  it("reclassifies metadata arriving after scanning and folder replacements", () => {
    const a = shallowReactive(track("mix/a.mp3"));
    const b = shallowReactive(track("mix/b.mp3"));
    const catalog = computed(() => buildCatalog([a, b], folder));
    expect(catalog.value.albums).toHaveLength(2);
    expect(catalog.value.albums[0]?.sourceFile).toEqual({ name: "a", path: "mix/a.mp3" });
    a.metadata = { album: "Mix", artist: "A" };
    b.metadata = { album: "Mix", artist: "B" };
    expect(catalog.value.albums).toHaveLength(1);
    expect(catalog.value.albums[0]?.sourceFile).toBeUndefined();
    b.metadata = { album: "Solo", artist: "B" };
    expect(catalog.value.albums).toHaveLength(2);
    b.metadata = { album: "Mix", artist: "B" };
    b.path = "other/b.mp3";
    expect(catalog.value.albums).toHaveLength(2);
  });
});
