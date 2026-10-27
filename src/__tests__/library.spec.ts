import { describe, expect, it } from "vite-plus/test";
import { scanDirectory, type MusicDirectory } from "../lib/library";

function file(name: string): FileSystemFileHandle {
  return { kind: "file", name } as FileSystemFileHandle;
}

function folder(name: string, entries: FileSystemHandle[]): MusicDirectory {
  return {
    kind: "directory",
    name,
    async *values() {
      yield* entries;
    },
  } as unknown as MusicDirectory;
}

describe("scanDirectory", () => {
  it("finds supported files recursively and sorts their paths naturally", async () => {
    const root = folder("Music", [
      file("10.flac"),
      folder("Album", [file("02.MP3"), file("01.m4a"), file("cover.jpg")]),
      file("2.mp3"),
      file("notes.txt"),
    ]);

    const tracks = await scanDirectory(root);
    expect(tracks.map((track) => track.path)).toEqual([
      "2.mp3",
      "10.flac",
      "Album/01.m4a",
      "Album/02.MP3",
    ]);
  });

  it("propagates a revoked permission instead of returning a partial library", async () => {
    const denied = {
      values() {
        return {
          async *[Symbol.asyncIterator]() {
            yield await Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
          },
        };
      },
    } as unknown as MusicDirectory;
    await expect(scanDirectory(denied)).rejects.toMatchObject({ name: "NotAllowedError" });
  });
});
