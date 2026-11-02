import { parseBlob } from "music-metadata";
import type { MetadataRequest, MetadataResponse } from "./metadata-protocol";

import { MAX_COVER_INPUT, thumbnail } from "./artwork";

self.onmessage = async (event: MessageEvent<MetadataRequest>) => {
  const { id, file } = event.data;
  let response: MetadataResponse;
  try {
    const parsed = await parseBlob(file, {
      duration: false,
      maxMemoryAllocation: MAX_COVER_INPUT,
      maxMetadataEntries: 4096,
    });
    const { title, artist, album, picture } = parsed.common;
    const cover = picture?.[0];
    const artwork = cover ? await thumbnail(cover.data, cover.format) : undefined;
    response = { id, metadata: { title, artist, album }, artwork };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : "Parse failed" };
  }
  self.postMessage(response);
};
