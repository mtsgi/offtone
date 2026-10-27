import { describe, expect, it, vi } from "vite-plus/test";
import type { MusicDirectory } from "../lib/library";
import { queryDirectoryPermission, requestDirectoryPermission } from "../lib/storage";

describe("フォルダーへのアクセス権", () => {
  it("読み取り権限を確認し、ユーザー操作に応じて再要求する", async () => {
    const queryPermission = vi.fn().mockResolvedValue("prompt");
    const requestPermission = vi.fn().mockResolvedValue("granted");
    const directory = { queryPermission, requestPermission } as unknown as MusicDirectory;

    await expect(queryDirectoryPermission(directory)).resolves.toBe("prompt");
    expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(requestPermission).not.toHaveBeenCalled();

    await expect(requestDirectoryPermission(directory)).resolves.toBe("granted");
    expect(requestPermission).toHaveBeenCalledWith({ mode: "read" });
  });
});
