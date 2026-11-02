import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MAX_COVER_INPUT, thumbnail } from "../workers/artwork";

afterEach(() => vi.unstubAllGlobals());
describe("artwork limits", () => {
  it("does not decode oversized or unsupported image data", async () => {
    const decode = vi.fn();
    vi.stubGlobal("createImageBitmap", decode);
    expect(await thumbnail(new Uint8Array(MAX_COVER_INPUT + 1), "image/jpeg")).toBeUndefined();
    expect(await thumbnail(new Uint8Array(1), "image/svg+xml")).toBeUndefined();
    expect(decode).not.toHaveBeenCalled();
  });
  it("handles corrupt images and closes the decoded bitmap", async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error("bad image"));
    vi.stubGlobal("createImageBitmap", decode);
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage };
        }
        convertToBlob() {
          return Promise.resolve(new Blob(["small"], { type: "image/webp" }));
        }
      },
    );
    expect(await thumbnail(new Uint8Array(1), "image/png")).toBeUndefined();
    decode.mockResolvedValueOnce({ width: 1200, height: 600, close });
    const blob = await thumbnail(new Uint8Array(1), "image/jpeg");
    expect(blob?.size).toBe(5);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 256, 128);
    expect(close).toHaveBeenCalledOnce();
  });
});
