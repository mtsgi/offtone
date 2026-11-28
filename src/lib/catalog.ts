/** 保存・プレイリスト参照用の ID。サイズや更新日時には依存しない。 */
export type RootId = string;
export type TrackId = string;

/** File System Access API の各パス要素は大文字小文字や Unicode を区別する。 */
export function normalizeRelativePath(path: string): string {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid relative path");
  }
  return parts.join("/");
}

/** JSON の配列形式は区切り文字を含む名前でも衝突しない。 */
export function trackId(rootId: RootId, path: string): TrackId {
  return JSON.stringify([rootId, normalizeRelativePath(path)]);
}

export interface FileFingerprint {
  size: number;
  lastModified: number;
}

export interface TrackMetadata {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  trackNumber?: number;
  discNumber?: number;
  artworkRef?: string;
}

export interface TrackRecord extends FileFingerprint {
  id: TrackId;
  rootId: RootId;
  path: string;
  metadata?: TrackMetadata;
  metadataVersion?: number;
  /** Bounded thumbnail, never the original image or audio. */
  artwork?: Blob;
}

export function fileChanged(previous: FileFingerprint, current: FileFingerprint): boolean {
  return previous.size !== current.size || previous.lastModified !== current.lastModified;
}

export function metadataIsValid(
  record: TrackRecord,
  current: FileFingerprint,
  parserVersion: number,
): boolean {
  return (
    !!record.metadata && record.metadataVersion === parserVersion && !fileChanged(record, current)
  );
}

/** Reject transient IDs and references to a different root at persistence boundaries. */
export function assertTrackInRoot(rootId: RootId, id: TrackId): void {
  try {
    const parts: unknown = JSON.parse(id);
    if (
      rootId &&
      Array.isArray(parts) &&
      typeof parts[1] === "string" &&
      trackId(rootId, parts[1]) === id
    ) {
      return;
    }
  } catch {
    // Includes malformed JSON and invalid paths.
  }
  throw new TypeError("Expected a persistent track ID for the specified root");
}
