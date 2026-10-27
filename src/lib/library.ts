/** 再生可能なファイルと、選択したフォルダーからの相対パス。 */
export interface Track {
  name: string;
  path: string;
  handle: FileSystemFileHandle;
}

export interface MusicDirectory extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
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
