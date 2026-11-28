import type { Track } from "./library";

export const UNKNOWN_ARTIST = "不明なアーティスト";
export const UNKNOWN_ALBUM = "不明なアルバム";
export const VARIOUS_ARTISTS = "Various Artists";

export type AlbumGrouping = "metadata" | "folder";
export interface CatalogOptions {
  albumGrouping?: AlbumGrouping;
}

const value = (text?: string) => text?.trim() || undefined;
export const trackTitle = (track: Track) =>
  value(track.metadata?.title) ?? track.name.replace(/\.[^.]+$/, "");
export const trackArtist = (track: Track) => value(track.metadata?.artist) ?? UNKNOWN_ARTIST;
export const trackAlbum = (track: Track) => value(track.metadata?.album) ?? UNKNOWN_ALBUM;

export const albumDiscNumber = (track: Track) => track.metadata?.discNumber ?? 1;

export function sortByRecordingOrder(tracks: readonly Track[]): Track[] {
  if (!tracks.some((track) => track.metadata?.trackNumber !== undefined)) return [...tracks];
  return [...tracks].sort((a, b) => {
    const discOrder = albumDiscNumber(a) - albumDiscNumber(b);
    if (discOrder) return discOrder;
    const aNumber = a.metadata?.trackNumber ?? Infinity;
    const bNumber = b.metadata?.trackNumber ?? Infinity;
    return aNumber === bNumber ? 0 : aNumber - bNumber;
  });
}

export interface Album {
  key: string;
  name: string;
  artist: string;
  tracks: Track[];
  artworkUrl?: string;
  sourceFile?: { name: string; path: string };
}
export interface Artist {
  key: string;
  name: string;
  tracks: Track[];
  albums: Album[];
  artworkUrl?: string;
}

// Null distinguishes absent tags from a literal "unknown" label. JSON tuples avoid delimiter collisions.
export function albumKey(track: Track, options: CatalogOptions = {}): string {
  if (options.albumGrouping === "folder") {
    const album = value(track.metadata?.album);
    // Missing album tags never imply a shared work, even within one directory.
    if (!album) return JSON.stringify(["folder-track", track.path]);
    // scanDirectory produces root-relative paths with `/`. Keep literal backslashes,
    // case and whitespace in file names intact so distinct directories cannot merge.
    const parent = track.path.slice(0, Math.max(0, track.path.lastIndexOf("/")));
    return JSON.stringify(["folder", parent, album]);
  }
  return JSON.stringify([
    value(track.metadata?.album) ?? null,
    value(track.metadata?.albumArtist) ?? value(track.metadata?.artist) ?? null,
  ]);
}
function artistKey(name?: string): string {
  return JSON.stringify([value(name) ?? null]);
}

export function matchesTrack(track: Track, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return [
    trackTitle(track),
    trackArtist(track),
    trackAlbum(track),
    track.metadata?.albumArtist,
    track.path,
  ].some((text) => text?.toLowerCase().includes(term));
}

/** Preserve library order; no tag-based track ordering is implied. */
export function buildCatalog(
  tracks: readonly Track[],
  options: CatalogOptions = {},
): { albums: Album[]; artists: Artist[] } {
  const albums = new Map<string, Album>();
  const artists = new Map<string, Artist>();
  for (const track of tracks) {
    const key = albumKey(track, options);
    let album = albums.get(key);
    if (!album) {
      album = {
        key,
        name: trackAlbum(track),
        artist:
          value(track.metadata?.albumArtist) ?? value(track.metadata?.artist) ?? UNKNOWN_ARTIST,
        tracks: [],
      };
      if (options.albumGrouping === "folder" && !value(track.metadata?.album)) {
        album.sourceFile = { name: track.name.replace(/\.[^.]+$/, ""), path: track.path };
      }
      albums.set(key, album);
    }
    album.tracks.push(track);
    album.artworkUrl ??= track.artworkUrl;
    // A track appears under its performing artist and, if different, its album artist.
    const names = [value(track.metadata?.artist), value(track.metadata?.albumArtist)];
    if (!names[0] && !names[1]) names.splice(1);
    const seen = new Set<string>();
    for (const name of names.filter((name, index) => name || index === 0)) {
      const artistId = artistKey(name);
      if (seen.has(artistId)) continue;
      seen.add(artistId);
      let artist = artists.get(artistId);
      if (!artist) {
        artist = { key: artistId, name: name ?? UNKNOWN_ARTIST, tracks: [], albums: [] };
        artists.set(artistId, artist);
      }
      artist.tracks.push(track);
      artist.artworkUrl ??= track.artworkUrl;
      if (!artist.albums.includes(album)) artist.albums.push(album);
    }
  }
  if (options.albumGrouping === "folder") {
    for (const album of albums.values()) {
      const names = new Set(
        album.tracks.map(
          (track) =>
            value(track.metadata?.albumArtist) ?? value(track.metadata?.artist) ?? UNKNOWN_ARTIST,
        ),
      );
      album.artist = names.size === 1 ? [...names][0]! : VARIOUS_ARTISTS;
    }
  }
  return { albums: [...albums.values()], artists: [...artists.values()] };
}
