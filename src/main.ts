import { createApp, vaporInteropPlugin } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import ui from "@nuxt/ui/vue-plugin";
import App from "./App.vue";
import "./style.css";

const router = createRouter({ history: createMemoryHistory(), routes: [] });

createApp(App).use(vaporInteropPlugin).use(createPinia()).use(router).use(ui).mount("#app");

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
