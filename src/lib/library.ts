import type { TrackMetadata } from "./catalog";

/** 再生可能なファイルと、選択したフォルダーからの相対パス。 */
export interface Track {
  /** 永続化に成功したルートでのみ利用可能。既存の再生処理は path を使う。 */
  id?: string;
  name: string;
  path: string;
  handle: FileSystemFileHandle;
  metadata?: TrackMetadata;
  artworkUrl?: string;
}

export interface MusicDirectory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
}

export interface MusicFolder {
  path: string;
  name: string;
  children: MusicFolder[];
  tracks: Track[];
}

const folderNames = new Intl.Collator("ja", { numeric: true });

export function parentFolderPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/** Index the scanned library using its exact, slash-separated relative paths. */
export function buildFolderTree(tracks: readonly Track[]) {
  const root: MusicFolder = { path: "", name: "", children: [], tracks: [] };
  const folders = new Map([[root.path, root]]);
  for (const track of tracks) {
    const segments = track.path.split("/");
    let parent = root;
    for (const name of segments.slice(0, -1)) {
      const path = parent.path ? `${parent.path}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) {
        folder = { path, name, children: [], tracks: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.tracks.push(track);
  }
  for (const folder of folders.values()) {
    folder.children.sort((a, b) => folderNames.compare(a.name, b.name));
  }
  return { root, folders };
}

export function matchingFolderPaths(tracks: readonly Track[]): Set<string> {
  const paths = new Set<string>();
  for (const track of tracks) {
    let path = parentFolderPath(track.path);
    while (!paths.has(path)) {
      paths.add(path);
      if (!path) break;
      path = parentFolderPath(path);
    }
  }
  return paths;
}

export function folderAncestors(tree: ReturnType<typeof buildFolderTree>, path: string) {
  const ancestors: MusicFolder[] = [];
  while (path) {
    const folder = tree.folders.get(path);
    if (folder) ancestors.push(folder);
    path = parentFolderPath(path);
  }
  // The root is always available, including when the library is empty.
  ancestors.push(tree.root);
  return ancestors.reverse();
}

const AUDIO_EXTENSION = /\.(mp3|m4a|flac)$/i;
/** サブフォルダーを含め、対応する音声ファイルを列挙する。 */
export async function scanDirectory(directory: MusicDirectory): Promise<Track[]> {
  const tracks: Track[] = [];

  async function visit(folder: MusicDirectory, prefix: string): Promise<void> {
    for await (const entry of folder.values()) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.kind === "directory") {
        await visit(entry as MusicDirectory, path);
      } else if (AUDIO_EXTENSION.test(entry.name)) {
        tracks.push({ name: entry.name, path, handle: entry as FileSystemFileHandle });
      }
    }
  }

  await visit(directory, "");
  return tracks.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}
