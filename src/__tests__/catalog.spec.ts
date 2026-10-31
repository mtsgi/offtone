import { describe, expect, it } from "vite-plus/test";
import { fileChanged, metadataIsValid, normalizeRelativePath, trackId } from "../lib/catalog";

describe("永続 ID とキャッシュ", () => {
  it("ルートと相対パスを区別し、曖昧なパスを拒否する", () => {
    expect(normalizeRelativePath("Album/a.mp3")).toBe("Album/a.mp3");
    expect(() => normalizeRelativePath("../a.mp3")).toThrow();
    expect(() => normalizeRelativePath("a//b.mp3")).toThrow();
    expect(trackId("root-a", "Album/a.mp3")).toBe(trackId("root-a", "Album/a.mp3"));
    expect(trackId("root-a", "Album/a.mp3")).not.toBe(trackId("root-b", "Album/a.mp3"));
    expect(trackId('a", "b', "c")).not.toBe(trackId("a", 'b", "c'));
    expect(trackId("root", "A.mp3")).not.toBe(trackId("root", "a.mp3"));
  });

  it("サイズ・更新日時・解析バージョンでキャッシュを判定する", () => {
    const record = {
      id: "id",
      rootId: "root",
      path: "a.mp3",
      size: 10,
      lastModified: 20,
      metadata: { title: "A", artworkRef: "art" },
      metadataVersion: 1,
    };
    expect(fileChanged(record, { size: 10, lastModified: 20 })).toBe(false);
    expect(fileChanged(record, { size: 11, lastModified: 20 })).toBe(true);
    expect(fileChanged(record, { size: 10, lastModified: 21 })).toBe(true);
    expect(metadataIsValid(record, { size: 10, lastModified: 20 }, 1)).toBe(true);
    expect(metadataIsValid(record, { size: 10, lastModified: 20 }, 2)).toBe(false);
    expect(metadataIsValid(record, { size: 11, lastModified: 20 }, 1)).toBe(false);
  });
});
