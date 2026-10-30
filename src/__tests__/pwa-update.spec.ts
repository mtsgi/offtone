import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createPwaUpdate } from "../lib/pwa-update";

function setup() {
  vi.useFakeTimers();
  const workers = new EventTarget() as ServiceWorkerContainer;
  let controller: object | null = {};
  Object.defineProperty(workers, "controller", { get: () => controller });
  const browser = new EventTarget() as Window;
  const reload = vi.fn();
  Object.defineProperty(browser, "location", { value: { reload } });
  const checkForUpdate = vi.fn().mockResolvedValue(undefined);
  const registration = {
    waiting: {},
    update: checkForUpdate,
  } as unknown as ServiceWorkerRegistration;
  let callbacks!: Parameters<Parameters<typeof createPwaUpdate>[0]>[0];
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn((options: typeof callbacks) => {
    callbacks = options;
    return update;
  });
  const updater = createPwaUpdate(register, workers, browser);
  callbacks.onRegisteredSW("/offtone/sw.js", registration);
  function changeController() {
    controller = {};
    workers.dispatchEvent(new Event("controllerchange"));
  }
  return {
    updater,
    callbacks,
    registration,
    checkForUpdate,
    update,
    reload,
    changeController,
    browser,
    register,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PWA updates", () => {
  it("does nothing without an update and detects a waiting version", () => {
    const { updater, callbacks, reload } = setup();
    expect(updater.state.available).toBe(false);
    callbacks.onNeedRefresh();
    expect(updater.state.available).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    updater.dispose();
  });

  it("defers playback updates and allows the notice to be reopened", () => {
    const { updater, callbacks, update, reload } = setup();
    callbacks.onNeedRefresh();
    updater.requestUpdate(true);
    expect(updater.state.confirming).toBe(true);
    updater.defer();
    expect(updater.state.deferred).toBe(true);
    expect(updater.state.available).toBe(true);
    updater.show();
    expect(updater.state.deferred).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    updater.dispose();
  });

  it("applies while stopped only after the worker takes control, ignoring duplicate requests", async () => {
    const { updater, callbacks, update, changeController, reload } = setup();
    callbacks.onNeedRefresh();
    updater.requestUpdate(false);
    updater.requestUpdate(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(updater.state.applying).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    changeController();
    expect(reload).toHaveBeenCalledTimes(1);
    updater.dispose();
  });

  it("requires a second explicit action during playback", () => {
    const { updater, callbacks, update, changeController, reload } = setup();
    callbacks.onNeedRefresh();
    updater.requestUpdate(true);
    expect(update).not.toHaveBeenCalled();
    updater.requestUpdate(true);
    expect(update).not.toHaveBeenCalled();
    updater.confirmUpdate();
    expect(update).toHaveBeenCalledTimes(1);
    changeController();
    expect(reload).toHaveBeenCalledTimes(1);
    updater.dispose();
  });

  it("reports a failed or stalled activation and permits retry", async () => {
    const { updater, callbacks, update } = setup();
    callbacks.onNeedRefresh();
    update.mockRejectedValueOnce(new Error("failed"));
    updater.requestUpdate(false);
    await Promise.resolve();
    expect(updater.state.error).toContain("適用できませんでした");
    expect(updater.state.applying).toBe(false);
    updater.requestUpdate(false);
    vi.advanceTimersByTime(15000);
    expect(updater.state.error).toContain("適用できませんでした");
    expect(updater.state.applying).toBe(false);
    updater.dispose();
  });

  it("clears a stale notice if no worker is waiting", () => {
    const { updater, callbacks, registration, update } = setup();
    callbacks.onNeedRefresh();
    Object.defineProperty(registration, "waiting", { value: null });
    updater.requestUpdate(false);
    expect(updater.state.available).toBe(false);
    expect(updater.state.error).toContain("待機していません");
    expect(update).not.toHaveBeenCalled();
    updater.dispose();
  });

  it("does not reload when another tab activates the update", () => {
    const { updater, callbacks, changeController, reload, update, registration } = setup();
    callbacks.onNeedRefresh();
    updater.defer();
    Object.defineProperty(registration, "waiting", { value: null });
    changeController();
    callbacks.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    updater.show();
    updater.requestUpdate(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    updater.dispose();
  });

  it("checks for updates on return online and reports failures", async () => {
    const { updater, browser, checkForUpdate } = setup();
    checkForUpdate.mockRejectedValueOnce(new Error("offline"));
    browser.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(updater.state.error).toContain("確認に失敗");
    updater.dispose();
  });
});
