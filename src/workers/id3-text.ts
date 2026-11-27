import type { IAudioMetadata } from "music-metadata";
import { MAX_COVER_INPUT } from "./artwork";

const fields = ["title", "artist", "album", "albumartist"] as const;
const id3v23Ids = { title: "TIT2", artist: "TPE1", album: "TALB", albumartist: "TPE2" };
const tagIds = {
  ID3v1: { title: "title", artist: "artist", album: "album", albumartist: undefined },
  "ID3v2.2": { title: "TT2", artist: "TP1", album: "TAL", albumartist: "TP2" },
  "ID3v2.3": id3v23Ids,
  "ID3v2.4": id3v23Ids,
};
const id3v1Offsets = { title: 3, artist: 33, album: 63, albumartist: undefined };

const MAX_TEXT_BYTES = 4096;
const c1Control = /[\u0080-\u009f]/;
const replacement = "\ufffd";
const japaneseText =
  /^[ -~\u3000-\u303f\u3041-\u3096\u30a1-\u30fa\u30fc\uff01-\uff5e\p{Script=Han}]+$/u;

function looksJapanese(text: string | undefined): text is string {
  if (text === undefined || !japaneseText.test(text)) return false;
  for (const [run] of text.matchAll(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/gu,
  )) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]|\p{Script=Han}{3}/u.test(run)) return true;
  }
  return false;
}

function strictDecode(bytes: Uint8Array, encoding: string): string | undefined {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function recoverText(
  bytes: Uint8Array,
  encoding: number | undefined,
  original: string,
  trim: boolean,
) {
  // A short, single value is required. Keep separators and complex frames with the library.
  if (bytes.length > MAX_TEXT_BYTES) return;
  const zero = bytes.indexOf(0);
  if (zero >= 0) {
    if (bytes.subarray(zero).some((byte) => byte !== 0)) return;
    bytes = bytes.subarray(0, zero);
  }
  // These bytes are control codes in Latin-1 and can be part of Japanese multibyte sequences.
  if (!bytes.some((byte) => byte >= 0x80 && byte <= 0x9f)) return;

  const utf8 = strictDecode(bytes, "utf-8");
  const normalize = (text: string) => (trim ? text.trim() : text);
  if (encoding === 0) {
    // music-metadata's Latin-1 maps byte values directly to Unicode code points.
    if (normalize(String.fromCharCode(...bytes)) !== original) return;
  } else if (encoding === 3) {
    if (
      utf8 !== undefined ||
      !original.includes(replacement) ||
      normalize(new TextDecoder().decode(bytes)) !== original
    )
      return;
  } else return;

  const shiftJis = strictDecode(bytes, "shift_jis");
  if (utf8 !== undefined) {
    // Keep the original if the two decodings are both plausible.
    if (looksJapanese(utf8) && !looksJapanese(shiftJis)) return normalize(utf8);
  } else if (looksJapanese(shiftJis)) return normalize(shiftJis);
}

function readSize(bytes: Uint8Array, syncsafe: boolean): number {
  if (syncsafe && bytes.some((byte) => byte >= 0x80)) return -1;
  return bytes.reduce((size, byte) => size * (syncsafe ? 128 : 256) + byte, 0);
}

async function readId3v2(file: Blob) {
  const header = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (header.length !== 10 || String.fromCharCode(...header.subarray(0, 3)) !== "ID3") return;
  const major = header[3];
  // Restrict recovery to a plain leading tag. The library still parses tags with flags.
  if ((major !== 2 && major !== 3 && major !== 4) || header[4] !== 0 || header[5] !== 0) return;
  const size = readSize(header.subarray(6), true);
  if (size <= 0 || size > MAX_COVER_INPUT || size + 10 > file.size) return;

  const body = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
  const source = `ID3v2.${major}` as const;
  const ids = Object.values(tagIds[source]);
  const frames = new Map<string, (Uint8Array | undefined)[]>();
  const idSize = major === 2 ? 3 : 4;
  const sizeLength = major === 2 ? 3 : 4;
  const headerSize = major === 2 ? 6 : 10;
  for (let offset = 0; offset < body.length;) {
    if (body[offset] === 0 && body.subarray(offset).every((byte) => byte === 0)) break;
    if (offset + headerSize > body.length) return;
    const id = String.fromCharCode(...body.subarray(offset, offset + idSize));
    if (!/^[A-Z0-9]+$/.test(id)) return;
    const start = offset + headerSize;
    const sizeOffset = offset + idSize;
    const length = readSize(body.subarray(sizeOffset, sizeOffset + sizeLength), major === 4);
    if (length <= 0 || start + length > body.length) return;
    if (ids.includes(id)) {
      const flagged = major !== 2 && (body[offset + 8] !== 0 || body[offset + 9] !== 0);
      const entries = frames.get(id) ?? [];
      entries.push(flagged ? undefined : body.subarray(start, start + length));
      frames.set(id, entries);
    }
    offset = start + length;
  }
  return { source, frames };
}

function recoverFrames(
  frames: (Uint8Array | undefined)[] | undefined,
  count: number,
  original: string,
  trim: boolean,
) {
  // Each native value must be backed by a single readable frame.
  if (frames?.length !== count) return;
  let corrected: string | undefined;
  for (const frame of frames) {
    if (!frame) return;
    const candidate = recoverText(frame.subarray(1), frame[0], original, trim);
    if (candidate === undefined || (corrected !== undefined && corrected !== candidate)) return;
    corrected = candidate;
  }
  return corrected;
}

async function readId3v1(file: Blob) {
  if (file.size < 128) return;
  const trailer = new Uint8Array(await file.slice(-128).arrayBuffer());
  if (String.fromCharCode(...trailer.subarray(0, 3)) === "TAG") return trailer;
}

export async function recoverId3Text(file: Blob, parsed: IAudioMetadata) {
  const common = { ...parsed.common };
  const sources = parsed.format.tagTypes;
  if (
    parsed.format.container !== "MPEG" ||
    !sources.every((source): source is keyof typeof tagIds =>
      Object.prototype.hasOwnProperty.call(tagIds, source),
    )
  )
    return common;

  let v1: ReturnType<typeof readId3v1> | undefined;
  let v2: ReturnType<typeof readId3v2> | undefined;
  for (const field of fields) {
    const original = common[field];
    if (!original || (!c1Control.test(original) && !original.includes(replacement))) continue;
    // Follow the library's common value. Every matching source must support the same correction.
    let corrected: string | undefined;
    for (const source of sources) {
      const id = tagIds[source][field];
      const entries = parsed.native[source]?.filter((tag) => tag.id === id);
      if (!id || !entries?.some(({ value }) => value === original)) continue;
      if (entries.some(({ value }) => value !== original)) {
        corrected = undefined;
        break;
      }

      let candidate: string | undefined;
      if (source === "ID3v1") {
        const trailer = await (v1 ??= readId3v1(file));
        const offset = id3v1Offsets[field];
        if (trailer && offset !== undefined && entries.length === 1) {
          candidate = recoverText(trailer.subarray(offset, offset + 30), 0, original, true);
        }
      } else {
        const tag = await (v2 ??= readId3v2(file));
        const frames = tag?.source === source ? tag.frames.get(id) : undefined;
        const trim = id === "TP1" || id === "TPE1" || (source === "ID3v2.4" && id !== "TIT2");
        candidate = recoverFrames(frames, entries.length, original, trim);
      }
      if (candidate === undefined || (corrected !== undefined && corrected !== candidate)) {
        corrected = undefined;
        break;
      }
      corrected = candidate;
    }
    if (corrected !== undefined) common[field] = corrected;
  }
  return common;
}
