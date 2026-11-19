import { DEFAULT_SETTINGS, isTheme, type Theme } from "./settings";

// The head script uses this same key and accepts only fixed theme values.
const THEME_HINT_KEY = "offtone-theme";

export function readThemeHint(): Theme {
  try {
    const theme = localStorage.getItem(THEME_HINT_KEY);
    if (isTheme(theme)) return theme;
  } catch {
    // Storage can be blocked. System appearance is still available.
  }
  return DEFAULT_SETTINGS.theme;
}

export function saveThemeHint(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_HINT_KEY);
    else localStorage.setItem(THEME_HINT_KEY, theme);
  } catch {
    // This cache is optional. IndexedDB remains the source of truth.
  }
}

export function applyTheme(theme: Theme, systemDark: boolean): void {
  const dark = theme === "dark" || (theme === "system" && systemDark);
  document.documentElement.classList.toggle("dark", dark);
}
