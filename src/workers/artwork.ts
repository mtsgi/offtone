// Limit both compressed input and persisted output. Never retain original cover bytes.
export const MAX_COVER_INPUT = 4 * 1024 * 1024;
const MAX_COVER_OUTPUT = 128 * 1024;
const MAX_EDGE = 256;

export async function thumbnail(data: Uint8Array, format: string): Promise<Blob | undefined> {
  if (data.byteLength > MAX_COVER_INPUT || !/^image\/(jpeg|png|webp)$/i.test(format)) return;
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") return;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: format }));
    // Refuse very large decoded images; do not persist an unscaled fallback.
    if (bitmap.width * bitmap.height > 16_000_000) return;
    const scale = Math.min(1, MAX_EDGE / bitmap.width, MAX_EDGE / bitmap.height);
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.75 });
    return blob.size <= MAX_COVER_OUTPUT ? blob : undefined;
  } catch {
    return;
  } finally {
    bitmap?.close();
  }
}
