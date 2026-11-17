import { createViewHistory } from "./view-history";

/** Compatibility adapter; the app shares one controller with settings navigation. */
export function createNowPlayingHistory(browser: Window, setOpen: (open: boolean) => void) {
  const history = createViewHistory(browser, (view) => setOpen(view.nowPlaying));
  return {
    open: () => history.openNowPlaying(),
    close: () => history.closeNowPlaying(),
    dispose: () => history.dispose(),
  };
}
