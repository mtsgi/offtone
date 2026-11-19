import { JSDOM } from "jsdom";
import { describe, expect, it } from "vite-plus/test";
import html from "../../index.html?raw";

describe("startup theme", () => {
  it.each([
    { saved: "dark", systemDark: false, dark: true },
    { saved: "light", systemDark: true, dark: false },
    { saved: null, systemDark: true, dark: true },
    { saved: "invalid", systemDark: false, dark: false },
    { saved: "blocked", systemDark: true, dark: true },
  ])(
    "applies $saved before the app loads (system dark: $systemDark)",
    ({ saved, systemDark, dark }) => {
      const dom = new JSDOM(html, {
        url: "https://offtone.test/",
        runScripts: "dangerously",
        beforeParse(window) {
          Object.defineProperty(window, "matchMedia", {
            value: () => ({ matches: systemDark }),
          });
          if (saved === "blocked") {
            Object.defineProperty(window, "localStorage", {
              get() {
                throw new DOMException("blocked", "SecurityError");
              },
            });
          } else if (saved) {
            window.localStorage.setItem("offtone-theme", saved);
          }
        },
      });
      try {
        expect(dom.window.document.documentElement.classList.contains("dark")).toBe(dark);
        expect(dom.window.document.querySelector("#app")?.childElementCount).toBe(0);
      } finally {
        dom.window.close();
      }
    },
  );
});
