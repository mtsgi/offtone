// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseBlob } from "music-metadata";

describe("generated audio fixtures", () => {
  for (const extension of ["mp3", "m4a", "flac"]) {
    it(`reads tags from ${extension}`, async () => {
      const bytes = await readFile(new URL(`./fixtures/tagged.${extension}`, import.meta.url));
      const metadata = await parseBlob(new Blob([bytes]), { maxMemoryAllocation: 4 * 1024 * 1024 });
      expect(metadata.common).toMatchObject({
        title: "Fixture Title",
        artist: "Fixture Artist",
        album: "Fixture Album",
      });
      if (extension === "mp3") expect(metadata.common.picture?.[0]?.format).toBe("image/jpeg");
    });
  }
  it("leaves an untagged file without a title for filename fallback", async () => {
    const bytes = await readFile(new URL("./fixtures/untagged.mp3", import.meta.url));
    const parsed = await parseBlob(new Blob([bytes]));
    expect(parsed.common.title).toBeUndefined();
  });
  it("rejects a corrupt file without affecting another parse", async () => {
    await expect(parseBlob(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow();
    const bytes = await readFile(new URL("./fixtures/tagged.flac", import.meta.url));
    expect((await parseBlob(new Blob([bytes]))).common.title).toBe("Fixture Title");
  });
});
