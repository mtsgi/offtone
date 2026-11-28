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

function readNumber(parsed: IAudioMetadata, field: NumberField): number | undefined {
  const number = parsed.common[field]?.no;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) return;

  // music-metadata uses parseInt for textual numbers, so an invalid value such as
  // "2.5" can also produce common.track.no = 2. Check the corresponding native tag.
  for (const [type, tags] of Object.entries(parsed.native)) {
    const pattern = numberTags[type]?.[field];
    if (!pattern) continue;
    const matches = tags.filter(({ id }) => pattern.test(id));
    const tag = matches[matches.length - 1];
    if (typeof tag?.value !== "string") continue;
    const numerator = tag.value.split("/", 1)[0]!.trim();
    if (Number.parseInt(numerator, 10) === number && !/^\+?\d+$/.test(numerator)) return;
  }
  return number;
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
