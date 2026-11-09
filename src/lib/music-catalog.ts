import type { Track } from "./library";

export const UNKNOWN_ARTIST = "不明なアーティスト";
export const UNKNOWN_ALBUM = "不明なアルバム";

const value = (text?: string) => text?.trim() || undefined;
export const trackTitle = (track: Track) =>
  value(track.metadata?.title) ?? track.name.replace(/\.[^.]+$/, "");
export const trackArtist = (track: Track) => value(track.metadata?.artist) ?? UNKNOWN_ARTIST;

export interface Album {
  key: string;
  name: string;
  artist: string;
  tracks: Track[];
  artworkUrl?: string;
}
export interface Artist {
  key: string;
  name: string;
  tracks: Track[];
  albums: Album[];
  artworkUrl?: string;
}

// Null distinguishes absent tags from a literal "unknown" label. JSON tuples avoid delimiter collisions.
export function albumKey(track: Track): string {
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
    value(track.metadata?.album) ?? UNKNOWN_ALBUM,
    track.metadata?.albumArtist,
    track.path,
  ].some((text) => text?.toLowerCase().includes(term));
}

/** Preserve library order; no tag-based track ordering is implied. */
export function buildCatalog(tracks: readonly Track[]): { albums: Album[]; artists: Artist[] } {
  const albums = new Map<string, Album>();
  const artists = new Map<string, Artist>();
  for (const track of tracks) {
    const key = albumKey(track);
    let album = albums.get(key);
    if (!album) {
      album = {
        key,
        name: value(track.metadata?.album) ?? UNKNOWN_ALBUM,
        artist:
          value(track.metadata?.albumArtist) ?? value(track.metadata?.artist) ?? UNKNOWN_ARTIST,
        tracks: [],
      };
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
  return { albums: [...albums.values()], artists: [...artists.values()] };
}
