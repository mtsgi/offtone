import { parseBlob } from "music-metadata";
import { MAX_COVER_INPUT } from "./artwork";
import { recoverId3Text } from "./id3-text";

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
    metadata: { title, artist, album, albumArtist: albumartist },
    cover: parsed.common.picture?.[0],
  };
}
