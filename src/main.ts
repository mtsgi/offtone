import { createApp, vaporInteropPlugin } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia } from "pinia";
import ui from "@nuxt/ui/vue-plugin";
import App from "./App.vue";
import "./style.css";

const router = createRouter({ history: createMemoryHistory(), routes: [] });

createApp(App).use(vaporInteropPlugin).use(createPinia()).use(router).use(ui).mount("#app");
