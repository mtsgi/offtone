import type { TrackMetadata } from "../lib/catalog";

export interface MetadataRequest {
  id: number;
  file: File;
}
export type MetadataResponse =
  | { id: number; metadata: TrackMetadata; artwork?: Blob }
  | { id: number; error: string };
