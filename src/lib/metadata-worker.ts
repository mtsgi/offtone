import type { MetadataRequest, MetadataResponse } from "../workers/metadata-protocol";

/** One worker, one file at a time. Cancellation terminates even a stuck parser. */
export class MetadataWorker {
  private worker: Worker | undefined;
  private pending: { reject: (cause: Error) => void } | undefined;
  private nextId = 0;

  parse(file: File): Promise<Extract<MetadataResponse, { metadata: unknown }>> {
    if (this.pending) return Promise.reject(new Error("Worker is busy"));
    try {
      this.worker ??= new Worker(new URL("../workers/metadata.worker.ts", import.meta.url), {
        type: "module",
      });
      const worker = this.worker;
      const id = ++this.nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => this.stop(), 30_000);
        this.pending = {
          reject: (cause) => {
            clearTimeout(timer);
            reject(cause);
          },
        };
        worker.onmessage = (event: MessageEvent<MetadataResponse>) => {
          if (event.data.id !== id) return;
          clearTimeout(timer);
          this.pending = undefined;
          if ("error" in event.data) reject(new Error(event.data.error));
          else resolve(event.data);
        };
        worker.onerror = () => {
          this.stop();
        };
        worker.onmessageerror = () => this.stop();
        try {
          worker.postMessage({ id, file } satisfies MetadataRequest);
        } catch (error) {
          clearTimeout(timer);
          this.pending = undefined;
          reject(error);
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate();
    }
    this.worker = undefined;
    this.pending?.reject(new Error("Metadata worker stopped"));
    this.pending = undefined;
  }
}
