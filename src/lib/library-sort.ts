import type { Track } from "./library";
import { trackAlbum, trackArtist, trackTitle, type Album, type Artist } from "./music-catalog";
import type { SortDirection, SortOrder } from "./settings";

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
const trackLabels = { title: trackTitle, artist: trackArtist, album: trackAlbum };

function sortItems<T>(
  items: readonly T[],
  direction: SortDirection,
  label?: (item: T) => string,
): T[] {
  if (!label) return direction === "asc" ? [...items] : [...items].reverse();

  const sign = direction === "asc" ? 1 : -1;
  // Stable sort keeps the input order for equal labels in either direction.
  return items
    .map((item) => ({ item, label: label(item) }))
    .sort((a, b) => sign * collator.compare(a.label, b.label))
    .map(({ item }) => item);
}

export function sortTracks(
  items: readonly Track[],
  { key, direction }: SortOrder<"tracks">,
): Track[] {
  return sortItems(items, direction, key === "library" ? undefined : trackLabels[key]);
}

export function sortAlbums(
  items: readonly Album[],
  { key, direction }: SortOrder<"albums">,
): Album[] {
  return sortItems(
    items,
    direction,
    key === "library" ? undefined : (album) => (key === "album" ? album.name : album.artist),
  );
}

export function sortArtists(
  items: readonly Artist[],
  { key, direction }: SortOrder<"artists">,
): Artist[] {
  return sortItems(items, direction, key === "library" ? undefined : (artist) => artist.name);
}
