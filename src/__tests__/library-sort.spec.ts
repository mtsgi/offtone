import { describe, expect, it } from "vite-plus/test";
import type { Track } from "../lib/library";
import { sortAlbums, sortArtists, sortTracks } from "../lib/library-sort";
import { buildCatalog, UNKNOWN_ALBUM, UNKNOWN_ARTIST } from "../lib/music-catalog";
import { DEFAULT_SETTINGS } from "../lib/settings";

function track(path: string, metadata?: Track["metadata"]): Track {
  return { path, name: path.split("/").pop()!, metadata, handle: {} as FileSystemFileHandle };
}

const tracks = Object.freeze([
  track("a/夜10.mp3"),
  track("a/ten.mp3", { title: "Song10", artist: "Artist10", album: "作品10" }),
  track("b/two.mp3", { title: " song2 ", artist: "Artist2", album: "作品2" }),
  track("c/two.mp3", { title: "Song2", artist: "Artist2", album: "作品2" }),
  track("d/夜2.mp3", { title: " ", artist: " ", album: " " }),
]);

describe("library sort", () => {
  it.each(["metadata", "folder"] as const)(
    "preserves or reverses the existing order in %s mode",
    (albumGrouping) => {
      const { albums, artists } = buildCatalog(tracks, { albumGrouping });
      const orders = DEFAULT_SETTINGS.librarySort;
      expect(sortTracks(tracks, orders.tracks)).toEqual(tracks);
      expect(sortTracks(tracks, orders.tracks)).not.toBe(tracks);
      expect(sortAlbums(albums, orders.albums)).toEqual(albums);
      expect(sortArtists(artists, orders.artists)).toEqual(artists);
      expect(sortTracks(tracks, { key: "library", direction: "desc" })).toEqual(
        [...tracks].reverse(),
      );
      expect(sortAlbums(albums, { key: "library", direction: "desc" })).toEqual(
        [...albums].reverse(),
      );
      expect(sortArtists(artists, { key: "library", direction: "desc" })).toEqual(
        [...artists].reverse(),
      );
    },
  );

  it.each([
    ["title", [2, 3, 1, 4, 0], [0, 4, 1, 2, 3]],
    ["artist", [2, 3, 1, 0, 4], [0, 4, 1, 2, 3]],
    ["album", [2, 3, 1, 0, 4], [0, 4, 1, 2, 3]],
  ] as const)(
    "sorts tracks by %s with numeric collation, stable ties and metadata fallbacks",
    (key, asc, desc) => {
      const before = structuredClone(tracks);
      for (const [direction, expected] of [
        ["asc", asc],
        ["desc", desc],
      ] as const) {
        const sorted = sortTracks(tracks, { key, direction });
        expect(sorted).toEqual(expected.map((index) => tracks[index]));
        for (const [index, original] of expected.entries())
          expect(sorted[index]).toBe(tracks[original]);
      }
      expect(tracks).toEqual(before);
    },
  );

  it.each(["metadata", "folder"] as const)(
    "sorts albums by displayed name or representative artist in %s mode",
    (albumGrouping) => {
      const { albums } = buildCatalog(
        [
          track("mix/a.mp3", { album: "Mix10", artist: "Z10" }),
          track("mix/b.mp3", { album: "Mix10", artist: "Z2" }),
          track("solo/a.mp3", { album: "Mix2", artist: "Artist", albumArtist: "A10" }),
          track("guest/b.mp3", { album: "Mix2", artist: "Artist", albumArtist: "A2" }),
          track("unknown.mp3"),
        ],
        { albumGrouping },
      );
      const before = structuredClone(albums);
      for (const direction of ["asc", "desc"] as const) {
        const byName = sortAlbums(albums, { key: "album", direction });
        expect([...new Set(byName.map(({ name }) => name))]).toEqual(
          direction === "asc" ? ["Mix2", "Mix10", UNKNOWN_ALBUM] : [UNKNOWN_ALBUM, "Mix10", "Mix2"],
        );
        expect(byName.filter(({ name }) => name === "Mix2").map(({ key }) => key)).toEqual(
          albums.filter(({ name }) => name === "Mix2").map(({ key }) => key),
        );
        const byArtist = sortAlbums(albums, { key: "artist", direction });
        const ascending =
          albumGrouping === "folder"
            ? ["A2", "A10", "Various Artists", UNKNOWN_ARTIST]
            : ["A2", "A10", "Z2", "Z10", UNKNOWN_ARTIST];
        expect(byArtist.map(({ artist }) => artist)).toEqual(
          direction === "asc" ? ascending : [...ascending].reverse(),
        );
      }
      expect(albums).toEqual(before);
    },
  );

  it("sorts artists with a stable tie between missing and literal unknown labels", () => {
    const { artists } = buildCatalog([
      track("one.mp3", { artist: "Artist10" }),
      track("unknown.mp3"),
      track("two.mp3", { artist: "Artist2" }),
      track("literal.mp3", { artist: UNKNOWN_ARTIST }),
    ]);
    const original = [...artists];
    expect(sortArtists(artists, { key: "artist", direction: "asc" })).toEqual([
      original[2],
      original[0],
      original[1],
      original[3],
    ]);
    expect(sortArtists(artists, { key: "artist", direction: "desc" })).toEqual([
      original[1],
      original[3],
      original[0],
      original[2],
    ]);
    expect(artists).toEqual(original);
  });
});
