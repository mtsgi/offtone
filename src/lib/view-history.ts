// The router uses memory history. Temporary entries handle Android Back for the
// settings page and its Now Playing overlay together, with one popstate listener.
const marker = "__offtoneView";
const legacyMarker = "__offtoneNowPlaying";
export interface AppView {
  settings: boolean;
  nowPlaying: boolean;
}
export function createViewHistory(browser: Window, setView: (view: AppView) => void) {
  const token = `${Date.now()}-${Math.random()}`;
  const entries = new Map<number, AppView>();
  let nextId = 0;
  let activeId = 0;
  let view: AppView = { settings: false, nowPlaying: false };
  let closing = false;
  const state = (): Record<string, unknown> =>
    browser.history.state && typeof browser.history.state === "object" ? browser.history.state : {};
  function clearMarker() {
    const { [marker]: _marker, [legacyMarker]: _legacy, ...rest } = state();
    browser.history.replaceState(rest, "");
  }
  function update(next: AppView) {
    if (view.settings === next.settings && view.nowPlaying === next.nowPlaying) return;
    view = { ...next };
    setView({ ...view });
  }
  // Reloads and forward navigation must not revive abandoned temporary screens.
  if (state()[marker] || state()[legacyMarker]) clearMarker();
  function onPop() {
    const entry = state()[marker] as { token?: string; id?: number } | undefined;
    const id = entry?.token === token && typeof entry.id === "number" ? entry.id : 0;
    const next = entries.get(id);
    activeId = next ? id : 0;
    for (const key of entries.keys()) if (key > activeId) entries.delete(key);
    if (!next && (state()[marker] || state()[legacyMarker])) clearMarker();
    closing = false;
    update(next ?? { settings: false, nowPlaying: false });
  }
  function push(next: AppView) {
    if (closing) return;
    const id = ++nextId;
    browser.history.pushState({ ...state(), [marker]: { token, id } }, "");
    entries.set(id, { ...next });
    activeId = id;
    update(next);
  }
  function back(next: AppView) {
    if (closing) return;
    update(next);
    if (activeId) {
      closing = true;
      browser.history.back();
    }
  }
  browser.addEventListener("popstate", onPop);
  return {
    openSettings() {
      if (!view.settings && !view.nowPlaying) push({ settings: true, nowPlaying: false });
    },
    closeSettings() {
      if (view.settings && !view.nowPlaying) back({ settings: false, nowPlaying: false });
    },
    openNowPlaying() {
      if (!view.nowPlaying) push({ ...view, nowPlaying: true });
    },
    closeNowPlaying() {
      if (view.nowPlaying) back({ ...view, nowPlaying: false });
    },
    dispose() {
      browser.removeEventListener("popstate", onPop);
      if (activeId) clearMarker();
      entries.clear();
    },
  };
}
