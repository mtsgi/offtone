import { describe, expect, it } from "vite-plus/test";
import {
  buildFolderTree,
  folderAncestors,
  matchingFolderPaths,
  scanDirectory,
  type MusicDirectory,
} from "../lib/library";
import { matchesTrack } from "../lib/music-catalog";

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

describe("folder browsing", () => {
  it("keeps exact names, distinct paths, root tracks and natural folder order", async () => {
    const tracks = await scanDirectory(
      folder("Music", [
        file("root.mp3"),
        folder("Folder10", [folder("同じ", [file("ten.mp3")])]),
        folder("Folder2", [
          folder("同じ", [folder(" A\\B ", [file("two.mp3"), file("other.m4a")])]),
          folder("a", [file("lower.flac")]),
          folder("A", [file("upper.flac")]),
        ]),
        folder("Empty", [file("cover.jpg")]),
      ]),
    );
    const tree = buildFolderTree(tracks);
    expect(tree.root.tracks.map((item) => item.path)).toEqual(["root.mp3"]);
    expect(tree.root.children.map((item) => item.name)).toEqual(["Folder2", "Folder10"]);
    expect(tree.folders.get("Folder2/A")?.tracks[0]?.name).toBe("upper.flac");
    expect(tree.folders.get("Folder2/a")?.tracks[0]?.name).toBe("lower.flac");
    expect(tree.folders.get("Folder10/同じ")?.name).toBe("同じ");
    expect(tree.folders.get("Folder2/同じ")?.tracks).toEqual([]);
    const path = "Folder2/同じ/ A\\B ";
    expect(tree.folders.get(path)?.name).toBe(" A\\B ");
    expect(folderAncestors(tree, path).map((item) => item.path)).toEqual([
      "",
      "Folder2",
      "Folder2/同じ",
      path,
    ]);
    const matching = tracks.filter((item) => matchesTrack(item, "TWO"));
    expect(matchingFolderPaths(matching)).toEqual(new Set(["", "Folder2", "Folder2/同じ", path]));
    expect(matchingFolderPaths([])).toEqual(new Set());
    expect(folderAncestors(tree, `${path}/removed/child`).pop()?.path).toBe(path);
    expect(folderAncestors(buildFolderTree([]), path).map((item) => item.path)).toEqual([""]);
  });
});
