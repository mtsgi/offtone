import { describe, expect, it, vi } from "vite-plus/test";
import { createViewHistory } from "../lib/view-history";

function setup(initial: Record<string, unknown> = { existing: 1 }) {
  const entries = [initial];
  const listeners = new Set<EventListener>();
  let index = 0;
  let pending = false;
  const back = vi.fn(() => {
    pending = true;
  });
  const browser = {
    history: {
      get state() {
        return entries[index];
      },
      pushState(next: typeof initial) {
        entries.splice(++index, entries.length, next);
      },
      replaceState(next: typeof initial) {
        entries[index] = next;
      },
      back,
    },
    addEventListener: (_: string, cb: EventListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: EventListener) => listeners.delete(cb),
  } as unknown as Window;
  function pop(delta = -1) {
    index += delta;
    pending = false;
    for (const cb of listeners) cb(new Event("popstate"));
  }
  const changed = vi.fn();
  const controller = createViewHistory(browser, changed);
  return { controller, changed, browser, back, pop, entries, listeners, isPending: () => pending };
}

describe("settings and Now Playing history", () => {
  it("handles library → settings → Now Playing → settings → library with Android Back", () => {
    const h = setup();
    h.controller.openSettings();
    h.controller.openNowPlaying();
    expect(h.entries).toHaveLength(3);
    expect(h.changed.mock.lastCall?.[0]).toEqual({ settings: true, nowPlaying: true });
    h.pop();
    expect(h.changed.mock.lastCall?.[0]).toEqual({ settings: true, nowPlaying: false });
    h.pop();
    expect(h.changed.mock.lastCall?.[0]).toEqual({ settings: false, nowPlaying: false });
    expect(h.browser.history.state).toEqual({ existing: 1 });
    expect(h.back).not.toHaveBeenCalled();
  });
  it("allows repeated explicit close/open cycles without duplicate entries or racing Back", () => {
    const h = setup();
    for (let i = 0; i < 3; i++) {
      h.controller.openSettings();
      h.controller.openSettings();
      h.controller.openNowPlaying();
      h.controller.closeSettings(); // the overlay owns the top entry
      h.controller.closeNowPlaying();
      h.controller.closeNowPlaying();
      h.controller.openNowPlaying(); // ignored while history.back is pending
      expect(h.isPending()).toBe(true);
      h.pop();
      expect(h.changed.mock.lastCall?.[0]).toEqual({ settings: true, nowPlaying: false });
      h.controller.closeSettings();
      h.controller.closeSettings();
      h.controller.openSettings();
      h.pop();
      expect(h.browser.history.state).toEqual({ existing: 1 });
    }
    expect(h.back).toHaveBeenCalledTimes(6);
  });
  it("handles Now Playing directly from the library and ignores stale forward entries", () => {
    const h = setup();
    h.controller.openNowPlaying();
    h.controller.openSettings();
    expect(h.entries).toHaveLength(2);
    h.pop();
    expect(h.changed.mock.lastCall?.[0]).toEqual({ settings: false, nowPlaying: false });
    h.pop(1);
    expect(h.browser.history.state).toEqual({ existing: 1 });
    expect(h.changed).toHaveBeenCalledTimes(2);
    h.controller.dispose();
    expect(h.listeners.size).toBe(0);
  });
  it("drops abandoned settings forward entries and reload markers, preserving foreign state", () => {
    const h = setup();
    h.controller.openSettings();
    h.controller.openNowPlaying();
    h.pop(-2);
    h.pop(1);
    expect(h.browser.history.state).toEqual({ existing: 1 });
    const stale = setup({
      existing: 2,
      __offtoneView: { token: "old", id: 4 },
      __offtoneNowPlaying: "legacy",
    });
    expect(stale.browser.history.state).toEqual({ existing: 2 });
    expect(stale.changed).not.toHaveBeenCalled();
    stale.controller.openSettings();
    stale.controller.dispose();
    expect(stale.browser.history.state).toEqual({ existing: 2 });
  });
});
