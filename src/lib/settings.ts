import type { AlbumGrouping } from "./music-catalog";

const TRACK_SORT_KEYS = ["library", "title", "artist", "album"] as const;

export const SORT_KEYS = {
  tracks: TRACK_SORT_KEYS,
  albumTracks: ["recording", ...TRACK_SORT_KEYS],
  albums: ["library", "album", "artist"],
  artists: ["library", "artist"],
} as const;
export type SortView = keyof typeof SORT_KEYS;
export type SortKey<V extends SortView> = (typeof SORT_KEYS)[V][number];
export const SORT_LABELS: Record<SortKey<SortView>, string> = {
  recording: "収録順",
  library: "ライブラリ順",
  title: "曲名",
  artist: "アーティスト名",
  album: "アルバム名",
};
export type SortDirection = "asc" | "desc";
export interface SortOrder<V extends SortView> {
  key: SortKey<V>;
  direction: SortDirection;
}

export type Theme = "system" | "light" | "dark";

export interface AppSettings {
  albumGrouping: AlbumGrouping;
  librarySort: { [V in SortView]: SortOrder<V> };
  theme: Theme;
}
export const DEFAULT_SETTINGS = {
  albumGrouping: "metadata",
  librarySort: {
    tracks: { key: "library", direction: "asc" },
    albumTracks: { key: "recording", direction: "asc" },
    albums: { key: "library", direction: "asc" },
    artists: { key: "library", direction: "asc" },
  },
  theme: "system",
} as const satisfies AppSettings;

export function isAlbumGrouping(value: unknown): value is AlbumGrouping {
  return value === "metadata" || value === "folder";
}

export function isSortView(value: unknown): value is SortView {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SORT_KEYS, value);
}

export function isSortKey<V extends SortView>(view: V, value: unknown): value is SortKey<V> {
  return SORT_KEYS[view].some((key) => key === value);
}

export function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseSort<V extends SortView>(view: V, value: unknown): SortOrder<V> {
  const { key, direction } = fields(value);
  return {
    key: isSortKey(view, key) ? key : DEFAULT_SETTINGS.librarySort[view].key,
    direction: isSortDirection(direction)
      ? direction
      : DEFAULT_SETTINGS.librarySort[view].direction,
  };
}

export function parseSettings(value: unknown): AppSettings {
  const { albumGrouping, librarySort, theme } = fields(value);
  const { tracks, albumTracks, albums, artists } = fields(librarySort);
  return {
    albumGrouping: isAlbumGrouping(albumGrouping) ? albumGrouping : DEFAULT_SETTINGS.albumGrouping,
    librarySort: {
      tracks: parseSort("tracks", tracks),
      albumTracks: parseSort("albumTracks", albumTracks),
      albums: parseSort("albums", albums),
      artists: parseSort("artists", artists),
    },
    theme: isTheme(theme) ? theme : DEFAULT_SETTINGS.theme,
  };
}
