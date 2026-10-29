import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite-plus";
import vue from "@vitejs/plugin-vue";
import ui from "@nuxt/ui/vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  staged: { "*": "vp check --fix" },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: [
    vue(),
    tailwindcss(),
    ui({
      dts: false,
      ui: { colors: { primary: "blue" } },
      icon: {
        clientBundle: {
          icons: [
            "lucide:folder-open",
            "lucide:refresh-cw",
            "lucide:shield-check",
            "lucide:triangle-alert",
            "lucide:file-music",
            "lucide:skip-back",
            "lucide:play",
            "lucide:pause",
            "lucide:skip-forward",
            "lucide:music-2",
          ],
        },
      },
    }),
    VitePWA({
      injectRegister: false,
      registerType: "prompt",
      includeAssets: ["icons/*.png"],
      manifest: {
        lang: "ja",
        name: "offtone",
        short_name: "offtone",
        description: "端末内の音楽をオフラインで楽しむプレーヤー",
        theme_color: "#2563eb",
        background_color: "#f5f5f0",
        display: "standalone",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,ico,woff2}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-files",
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
