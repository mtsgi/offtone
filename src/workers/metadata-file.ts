import { parseBlob, type IAudioMetadata } from "music-metadata";
import { MAX_COVER_INPUT } from "./artwork";
import { recoverId3Text } from "./id3-text";

type NumberField = "track" | "disk";
const numberTags: Record<string, Partial<Record<NumberField, RegExp>>> = {
  ID3v1: { track: /^track$/ },
  "ID3v2.2": { track: /^TRK$/i, disk: /^TPA$/i },
  "ID3v2.3": { track: /^TRCK$/i, disk: /^TPOS$/i },
  "ID3v2.4": { track: /^TRCK$/i, disk: /^TPOS$/i },
  APEv2: { track: /^track$/i, disk: /^(disc|discnumber)$/i },
  iTunes: { track: /^(trkn|mdta:track)$/i, disk: /^(disk|mdta:disc)$/i },
  vorbis: { track: /^tracknumber$/i, disk: /^discnumber$/i },
};

function parseTagNumber(value: unknown): number | undefined {
  if (typeof value === "string") {
    const numerator = value.split("/", 1)[0]!.trim();
    if (!/^\+?\d+$/.test(numerator)) return;
    value = Number(numerator);
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
}

function readNumber(parsed: IAudioMetadata, field: NumberField): number | undefined {
  const common = parsed.common[field]?.no;
  let hasNativeTag = false;
  let fallback: number | undefined;
  // Prefer the common number when a valid native tag supports it. music-metadata
  // uses parseInt, so a later malformed tag can truncate or overwrite that number.
  for (const [type, tags] of Object.entries(parsed.native)) {
    const pattern = numberTags[type]?.[field];
    if (!pattern) continue;
    for (const { id, value } of tags) {
      if (!pattern.test(id)) continue;
      hasNativeTag = true;
      const number = parseTagNumber(value);
      if (number === undefined) continue;
      if (number === common) return number;
      fallback = number;
    }
  }
  return hasNativeTag ? fallback : parseTagNumber(common);
}

export async function parseTrackFile(file: Blob) {
  const parsed = await parseBlob(file, {
    duration: false,
    maxMemoryAllocation: MAX_COVER_INPUT,
    maxMetadataEntries: 4096,
  });
  const { title, artist, album, albumartist } = await recoverId3Text(file, parsed).catch(
    () => parsed.common,
  );
  return {
    metadata: {
      title,
      artist,
      album,
      albumArtist: albumartist,
      trackNumber: readNumber(parsed, "track"),
      discNumber: readNumber(parsed, "disk"),
    },
    cover: parsed.common.picture?.[0],
  };
}
