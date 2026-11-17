import type { AlbumGrouping } from "./music-catalog";

export interface AppSettings {
  albumGrouping: AlbumGrouping;
}
export const DEFAULT_SETTINGS: Readonly<AppSettings> = { albumGrouping: "metadata" };

export function isAlbumGrouping(value: unknown): value is AlbumGrouping {
  return value === "metadata" || value === "folder";
}
export function parseSettings(value: unknown): AppSettings {
  const grouping =
    value && typeof value === "object" && "albumGrouping" in value
      ? value.albumGrouping
      : undefined;
  return { albumGrouping: isAlbumGrouping(grouping) ? grouping : DEFAULT_SETTINGS.albumGrouping };
}
