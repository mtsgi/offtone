// @vitest-environment node
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vite-plus/test";
import { parseBlob } from "music-metadata";
import { parseTrackFile } from "../workers/metadata-file";

const japanese = {
  title: "夜の音楽",
  artist: "青い空",
  album: "春の歌",
  albumArtist: "日本合唱団",
};
const shiftJis = {
  title: Buffer.from("96e982cc89b98a79", "hex"),
  artist: Buffer.from("90c282a28bf3", "hex"),
  album: Buffer.from("8f7482cc89cc", "hex"),
  albumArtist: Buffer.from("93fa967b8d878fa59263", "hex"),
};
const reportedMojibake = "\u0083A\u0083J\u0083V\u0083b\u0083N\u0083\u008c\u0083R\u0081[\u0083h";
const reportedTitle = Buffer.from("8341834a83568362834e838c8352815b8368", "hex");
const reportedMetadata = {
  title: "アカシックレコード",
  artist: "神楽月 (吉岡美咲) & 星宮ゆきな (和氣あず未)",
  album: "Precious Notes",
};

function fixture(name: string) {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url));
}

function syncsafe(size: number) {
  return Buffer.from([size >>> 21, (size >>> 14) & 127, (size >>> 7) & 127, size & 127]);
}

function id3Frame(major: number, id: string, encoding: number, bytes: Buffer, formatFlags = 0) {
  const header = Buffer.alloc(major === 2 ? 6 : 10);
  header.write(id);
  const length = bytes.length + 1;
  if (major === 4) syncsafe(length).copy(header, 4);
  else header.writeUIntBE(length, id.length, major === 2 ? 3 : 4);
  if (major !== 2) header[9] = formatFlags;
  return Buffer.concat([header, Buffer.of(encoding), bytes]);
}

function id3v2(major: number, frames: Buffer[], flags = 0) {
  const body = Buffer.concat(frames);
  return Buffer.concat([
    Buffer.from([0x49, 0x44, 0x33, major, 0, flags]),
    syncsafe(body.length),
    body,
  ]);
}

function id3v1(title: Buffer, artist: Buffer = Buffer.alloc(0), album: Buffer = Buffer.alloc(0)) {
  const trailer = Buffer.alloc(128);
  trailer.write("TAG");
  title.copy(trailer, 3, 0, 30);
  artist.copy(trailer, 33, 0, 30);
  album.copy(trailer, 63, 0, 30);
  return trailer;
}

function apev2(key: string, value: string) {
  const bytes = Buffer.from(value);
  const item = Buffer.alloc(8);
  item.writeUInt32LE(bytes.length);
  const entry = Buffer.concat([item, Buffer.from(`${key}\0`), bytes]);
  const footer = Buffer.alloc(32);
  footer.write("APETAGEX");
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(entry.length + footer.length, 12);
  footer.writeUInt32LE(1, 16);
  return Buffer.concat([entry, footer]);
}

async function mp3(leading?: Buffer, trailer?: Buffer) {
  const bytes = await fixture("untagged.mp3");
  const tagLength = bytes.subarray(6, 10).reduce((size, byte) => size * 128 + byte, 0);
  const content = Buffer.concat([
    ...(leading ? [leading] : []),
    bytes.subarray(10 + tagLength),
    ...(trailer ? [trailer] : []),
  ]);
  return new Blob([content]);
}

describe("track metadata from generated audio files", () => {
  for (const extension of ["mp3", "m4a", "flac"]) {
    it(`preserves ASCII tags from ${extension}`, async () => {
      const { metadata, cover } = await parseTrackFile(
        new Blob([await fixture(`tagged.${extension}`)]),
      );
      expect(metadata).toMatchObject({
        title: "Fixture Title",
        artist: "Fixture Artist",
        album: "Fixture Album",
      });
      if (extension === "mp3") expect(cover?.format).toBe("image/jpeg");
    });
  }
  it.each(["m4a", "flac"])("preserves Japanese Unicode tags from %s", async (extension) => {
    const file = new Blob([await fixture(`japanese.${extension}`)]);
    expect((await parseTrackFile(file)).metadata).toEqual(japanese);
  });
  it.each([
    [2, 1, "\ufeff", "utf16le"],
    [3, 1, "\ufeff", "utf16le"],
    [3, 1, "\ufeff", "utf16be"],
    [4, 2, "", "utf16be"],
    [4, 3, "", "utf8"],
  ])("preserves Japanese ID3v2.%i encoding %i (%s %s)", async (major, encoding, bom, charset) => {
    const ids = major === 2 ? ["TT2", "TP1", "TAL", "TP2"] : ["TIT2", "TPE1", "TALB", "TPE2"];
    const frames = Object.values(japanese).map((value, index) => {
      const bytes = Buffer.from(bom + value, charset === "utf8" ? "utf8" : "utf16le");
      return id3Frame(major, ids[index]!, encoding, charset === "utf16be" ? bytes.swap16() : bytes);
    });
    expect((await parseTrackFile(await mp3(id3v2(major, frames)))).metadata).toEqual(japanese);
  });

  it.each([2, 3, 4])("recovers legacy Shift_JIS in ID3v2.%i Latin-1 fields", async (major) => {
    const ids = major === 2 ? ["TT2", "TP1", "TAL", "TP2"] : ["TIT2", "TPE1", "TALB", "TPE2"];
    const frames = Object.values(shiftJis).map((bytes, index) =>
      id3Frame(major, ids[index]!, 0, bytes),
    );
    const file = await mp3(id3v2(major, frames));
    expect((await parseBlob(file)).common.title).toBe(shiftJis.title.toString("latin1"));
    expect((await parseTrackFile(file)).metadata).toEqual(japanese);
  });
  it("recovers Shift_JIS and UTF-8 from the ID3v1 footer when those fields are used", async () => {
    const file = await mp3(
      undefined,
      id3v1(shiftJis.title, shiftJis.artist, Buffer.from(japanese.album)),
    );
    expect((await parseBlob(file)).common.title).toBe(shiftJis.title.toString("latin1"));
    expect((await parseTrackFile(file)).metadata).toMatchObject({
      title: japanese.title,
      artist: japanese.artist,
      album: japanese.album,
    });
  });
  it("recovers UTF-8 marked Latin-1 and invalid UTF-8 that contains Shift_JIS", async () => {
    const file = await mp3(
      id3v2(4, [
        id3Frame(4, "TIT2", 0, Buffer.from(japanese.title)),
        id3Frame(4, "TPE1", 3, shiftJis.artist),
      ]),
    );
    const { common } = await parseBlob(file);
    expect(common.title).toBe(Buffer.from(japanese.title).toString("latin1"));
    expect(common.artist).toContain("\ufffd");
    expect((await parseTrackFile(file)).metadata).toMatchObject({
      title: japanese.title,
      artist: japanese.artist,
    });
  });
  it("keeps a valid ID3v2 title ahead of a legacy ID3v1 title and recovers the ID3v1-only album", async () => {
    const file = await mp3(
      id3v2(4, [id3Frame(4, "TIT2", 3, Buffer.from("正しいタイトル"))]),
      id3v1(shiftJis.title, undefined, shiftJis.album),
    );
    expect((await parseTrackFile(file)).metadata).toMatchObject({
      title: "正しいタイトル",
      album: japanese.album,
    });
  });
  it.each([
    { name: "single ID3v2 title", copies: 1, withId3v1: false },
    { name: "matching ID3v1 and ID3v2 titles", copies: 1, withId3v1: true },
    { name: "matching duplicate ID3v2 frames", copies: 2, withId3v1: false },
    {
      name: "matching titles in both ID3 versions and duplicate frames",
      copies: 2,
      withId3v1: true,
    },
  ])("recovers the reported title with $name", async ({ copies, withId3v1 }) => {
    const title = id3Frame(4, "TIT2", 0, reportedTitle);
    const file = await mp3(
      id3v2(4, [
        ...Array<Buffer>(copies).fill(title),
        id3Frame(4, "TPE1", 3, Buffer.from(reportedMetadata.artist)),
        id3Frame(4, "TALB", 0, Buffer.from(reportedMetadata.album)),
      ]),
      withId3v1 ? id3v1(reportedTitle) : undefined,
    );
    const { common, native } = await parseBlob(file);
    expect(common.title).toBe(reportedMojibake);
    expect(native["ID3v2.4"]?.filter(({ id }) => id === "TIT2")).toHaveLength(copies);
    if (withId3v1) expect(native.ID3v1).toContainEqual({ id: "title", value: reportedMojibake });
    expect((await parseTrackFile(file)).metadata).toMatchObject(reportedMetadata);
  });

  it("requires recovery evidence for each matching native title", async () => {
    const legacy = id3Frame(4, "TIT2", 0, reportedTitle);
    const literal = id3Frame(4, "TIT2", 3, Buffer.from(reportedMojibake));
    const files = [
      await mp3(id3v2(4, [literal]), id3v1(reportedTitle)),
      await mp3(id3v2(4, [legacy, literal])),
      await mp3(Buffer.concat([id3v2(4, [legacy]), id3v2(4, [literal])])),
      await mp3(id3v2(4, [legacy]), id3v1(Buffer.concat([reportedTitle, Buffer.of(0, 0x41)]))),
      await mp3(id3v2(4, [id3Frame(4, "TIT2", 0, reportedTitle, 0x02)]), id3v1(reportedTitle)),
      await mp3(id3v2(4, [Buffer.of(0, 0, 0, 6, 1, 0), legacy], 0x40), id3v1(reportedTitle)),
    ];
    for (const file of files) {
      const { common } = await parseBlob(file);
      expect(common.title).toBe(reportedMojibake);
      expect((await parseTrackFile(file)).metadata.title).toBe(common.title);
    }
  });

  it("retains the parser result when matching invalid UTF-8 frames recover to different titles", async () => {
    const first = id3Frame(4, "TIT2", 3, Buffer.from("82a082a2", "hex")); // あい
    const second = id3Frame(4, "TIT2", 3, Buffer.from("82a482a6", "hex")); // うえ
    const file = await mp3(id3v2(4, [first, second]));
    const { common, native } = await parseBlob(file);
    expect(common.title).toBe("\ufffd\ufffd\ufffd\ufffd");
    expect(native["ID3v2.4"]).toEqual(Array(2).fill({ id: "TIT2", value: common.title }));
    expect((await parseTrackFile(file)).metadata.title).toBe(common.title);
  });

  it.each([
    ["Comment", "APEv2 without a title"],
    ["Title", reportedMojibake],
  ])("retains the parser result when an APEv2 %s is present", async (key, value) => {
    const file = await mp3(id3v2(4, [id3Frame(4, "TIT2", 0, reportedTitle)]), apev2(key, value));
    const { common, format } = await parseBlob(file);
    expect(format.tagTypes).toContain("APEv2");
    expect(common.title).toBe(reportedMojibake);
    expect((await parseTrackFile(file)).metadata.title).toBe(common.title);
  });
  it("retains the original embedded artwork when correcting text", async () => {
    const { common } = await parseBlob(new Blob([await fixture("tagged.mp3")]));
    const cover = common.picture![0]!;
    const apic = Buffer.concat([Buffer.from("image/jpeg\0\x03\0"), Buffer.from(cover.data)]);
    const file = await mp3(
      id3v2(3, [id3Frame(3, "TIT2", 0, shiftJis.title), id3Frame(3, "APIC", 0, apic)]),
    );
    const parsed = await parseTrackFile(file);
    expect(parsed.metadata.title).toBe(japanese.title);
    expect(parsed.cover?.format).toBe("image/jpeg");
    expect(parsed.cover?.data).toEqual(cover.data);
  });

  it.each([
    ["Latin-1 accents", 0, Buffer.from("Édith Piaf - Café", "latin1")],
    ["short Shift_JIS", 0, Buffer.from("938c8b9e", "hex")], // 東京
    ["UTF-8 and Shift_JIS are both plausible", 0, Buffer.from("世界")], // Shift_JIS: 荳也阜
    ["halfwidth-only Shift_JIS", 0, Buffer.from("b6c0b6c5", "hex")],
    ["explicitly encoded literal mojibake", 3, Buffer.from(shiftJis.title.toString("latin1"))],
    ["explicitly encoded replacement character", 3, Buffer.from("正常\ufffd")],
    ["broken BOM UTF-16", 1, Buffer.of(0xff, 0xfe, 0x82)],
    ["UTF-16 marked Latin-1", 0, Buffer.from("\ufeff夜の音楽", "utf16le")],
    ["unknown encoding byte", 7, shiftJis.title],
    ["malformed UTF-8 and Shift_JIS", 3, Buffer.concat([shiftJis.title, Buffer.of(0x82)])],
    ["multiple text values", 0, Buffer.concat([shiftJis.title, Buffer.of(0), shiftJis.album])],
  ])("retains the parser result for %s", async (_name, encoding, bytes) => {
    const file = await mp3(id3v2(4, [id3Frame(4, "TIT2", encoding, bytes)]));
    expect((await parseTrackFile(file)).metadata.title).toBe((await parseBlob(file)).common.title);
  });
  it("retains text when the frame is flagged or duplicate frames have different values", async () => {
    const files = [
      await mp3(id3v2(4, [id3Frame(4, "TIT2", 0, shiftJis.title, 0x02)])),
      await mp3(
        id3v2(4, [
          id3Frame(4, "TIT2", 0, Buffer.from("First")),
          id3Frame(4, "TIT2", 0, shiftJis.title),
        ]),
      ),
    ];
    for (const file of files) {
      expect((await parseTrackFile(file)).metadata.title).toBe(shiftJis.title.toString("latin1"));
    }
  });
  it("leaves an untagged file without a title for filename fallback", async () => {
    const parsed = await parseTrackFile(new Blob([await fixture("untagged.mp3")]));
    expect(parsed.metadata.title).toBeUndefined();
  });
  it("rejects a corrupt file without affecting another parse", async () => {
    const truncatedTag = new Blob([
      id3v2(4, [id3Frame(4, "TIT2", 0, shiftJis.title)]).subarray(0, 12),
    ]);
    await expect(parseTrackFile(truncatedTag)).rejects.toThrow();
    expect((await parseTrackFile(new Blob([await fixture("tagged.flac")]))).metadata.title).toBe(
      "Fixture Title",
    );
  });
});
