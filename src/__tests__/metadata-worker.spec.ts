import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { MetadataWorker } from "../lib/metadata-worker";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("metadata worker lifecycle", () => {
  it("matches request IDs and restarts after cancellation", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const manager = new MetadataWorker();
    const file = new File([""], "a.mp3");
    const first = manager.parse(file);
    const old = FakeWorker.instances[0]!;
    expect(old.postMessage).toHaveBeenCalledWith({ id: 1, file });
    old.onmessage?.({ data: { id: 999, metadata: { title: "stale" } } } as MessageEvent);
    manager.stop();
    await expect(first).rejects.toThrow();
    expect(old.terminate).toHaveBeenCalledOnce();
    const second = manager.parse(file);
    const next = FakeWorker.instances[1]!;
    next.onmessage?.({ data: { id: 2, metadata: { title: "new" } } } as MessageEvent);
    await expect(second).resolves.toMatchObject({ metadata: { title: "new" } });
    manager.stop();
  });
  it("recovers from worker exceptions and parser errors", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const manager = new MetadataWorker();
    const file = new File([""], "broken.flac");
    const first = manager.parse(file);
    FakeWorker.instances[0]!.onerror?.();
    await expect(first).rejects.toThrow();
    const second = manager.parse(file);
    FakeWorker.instances[1]!.onmessage?.({ data: { id: 2, error: "broken" } } as MessageEvent);
    await expect(second).rejects.toThrow("broken");
    manager.stop();
  });
});
