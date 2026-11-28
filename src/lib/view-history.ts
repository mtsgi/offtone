import { parentFolderPath } from "./library";

// The router uses memory history. One listener handles Android Back through
// Now Playing, settings and the folder hierarchy in order.
const marker = "__offtoneView";
const legacyMarker = "__offtoneNowPlaying";
export interface AppView {
  settings: boolean;
  nowPlaying: boolean;
  folder: string;
}
const libraryView: AppView = { settings: false, nowPlaying: false, folder: "" };
const folderDepth = (path: string) => (path ? path.split("/").length : 0);
const isAncestor = (parent: string, path: string) =>
  parent !== path && (!parent || path.startsWith(`${parent}/`));

export function createViewHistory(browser: Window, setView: (view: AppView) => void) {
  const token = `${Date.now()}-${Math.random()}`;
  const entries = new Map<number, AppView>();
  let nextId = 0;
  let activeId = 0;
  let view = libraryView;
  let closing = false;
  let folderLimit: string | undefined;
  const state = (): Record<string, unknown> =>
    browser.history.state && typeof browser.history.state === "object" ? browser.history.state : {};
  function clearMarker() {
    const { [marker]: _marker, [legacyMarker]: _legacy, ...rest } = state();
    browser.history.replaceState(rest, "");
  }
  function update(next: AppView) {
    if (
      view.settings === next.settings &&
      view.nowPlaying === next.nowPlaying &&
      view.folder === next.folder
    )
      return;
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
    settleFolder(next ?? libraryView);
  }
  function push(next: AppView) {
    if (closing) return;
    const id = ++nextId;
    browser.history.pushState({ ...state(), [marker]: { token, id } }, "");
    entries.set(id, { ...next });
    activeId = id;
    update(next);
  }
  function back(next: AppView, steps = 1) {
    if (closing) return;
    update(next);
    if (activeId) {
      closing = true;
      if (steps === 1) browser.history.back();
      else browser.history.go(-steps);
    }
  }
  function settleFolder(next: AppView) {
    if (folderLimit === undefined || !isAncestor(folderLimit, next.folder)) {
      folderLimit = undefined;
      update(next);
      return;
    }
    const adjusted = { ...next, folder: folderLimit };
    // A refresh or root change can invalidate folders beneath an open overlay.
    // Keep that overlay open and discard the obsolete entries when it closes.
    if (next.settings || next.nowPlaying) {
      update(adjusted);
      return;
    }
    folderLimit = undefined;
    back(adjusted, folderDepth(next.folder) - folderDepth(adjusted.folder));
  }
  browser.addEventListener("popstate", onPop);
  return {
    openSettings() {
      if (!view.settings && !view.nowPlaying) push({ ...view, settings: true });
    },
    closeSettings() {
      if (view.settings && !view.nowPlaying) back({ ...view, settings: false });
    },
    openNowPlaying() {
      if (!view.nowPlaying) push({ ...view, nowPlaying: true });
    },
    closeNowPlaying() {
      if (view.nowPlaying) back({ ...view, nowPlaying: false });
    },
    navigateFolder(path: string) {
      if (isAncestor(path, view.folder)) {
        folderLimit = path;
        if (closing) update({ ...view, folder: path });
        else settleFolder(entries.get(activeId) ?? libraryView);
      } else if (path && path !== view.folder && parentFolderPath(path) === view.folder) {
        if (!view.settings && !view.nowPlaying) push({ ...view, folder: path });
      }
    },
    dispose() {
      browser.removeEventListener("popstate", onPop);
      if (activeId) clearMarker();
      entries.clear();
    },
  };
}
