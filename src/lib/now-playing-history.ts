// The router uses memory history. A single temporary browser entry lets Android Back
// dismiss the dialog without navigating away from the app.
const marker = "__offtoneNowPlaying";

export function createNowPlayingHistory(browser: Window, setOpen: (open: boolean) => void) {
  const token = `${Date.now()}-${Math.random()}`;
  let open = false;
  let closing = false;
  const state = () =>
    browser.history.state && typeof browser.history.state === "object" ? browser.history.state : {};
  const ownsEntry = () => state()[marker] === token;
  function clearMarker() {
    const { [marker]: _marker, ...rest } = state();
    browser.history.replaceState(rest, "");
  }
  // A reload or a forward navigation can revisit an old temporary entry.
  if (state()[marker]) clearMarker();
  function onPop() {
    if (open) {
      open = false;
      setOpen(false);
    }
    closing = false;
    if (state()[marker]) clearMarker();
  }
  browser.addEventListener("popstate", onPop);
  return {
    open() {
      if (open || closing) return;
      browser.history.pushState({ ...state(), [marker]: token }, "");
      open = true;
      setOpen(true);
    },
    close() {
      if (!open || closing) return;
      open = false;
      setOpen(false);
      if (ownsEntry()) {
        closing = true;
        browser.history.back();
      }
    },
    dispose() {
      browser.removeEventListener("popstate", onPop);
      if (ownsEntry()) clearMarker();
    },
  };
}
