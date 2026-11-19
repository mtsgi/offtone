import type { MetadataRequest, MetadataResponse } from "./metadata-protocol";
import { thumbnail } from "./artwork";
import { parseTrackFile } from "./metadata-file";

self.onmessage = async (event: MessageEvent<MetadataRequest>) => {
  const { id, file } = event.data;
  let response: MetadataResponse;
  try {
    const { metadata, cover } = await parseTrackFile(file);
    const artwork = cover ? await thumbnail(cover.data, cover.format) : undefined;
    response = { id, metadata, artwork };
  } catch (error) {
    response = { id, error: error instanceof Error ? error.message : "Parse failed" };
  }
  self.postMessage(response);
};
