import { fileURLToPath } from "node:url";
import { mergeConfig, defineConfig, configDefaults } from "vite-plus";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        pinia: fileURLToPath(new URL("./node_modules/pinia/dist/pinia.js", import.meta.url)),
        vue: fileURLToPath(
          new URL("./node_modules/vue/dist/vue.runtime.esm-bundler.js", import.meta.url),
        ),
        ...Object.fromEntries(
          ["runtime-dom", "runtime-core", "runtime-vapor", "reactivity", "shared"].map((name) => [
            `@vue/${name}`,
            fileURLToPath(
              new URL(`./node_modules/@vue/${name}/dist/${name}.esm-bundler.js`, import.meta.url),
            ),
          ]),
        ),
      },
    },
    test: {
      server: { deps: { inline: [/node_modules/] } },
      environment: "jsdom",
      exclude: [...configDefaults.exclude, "e2e/**"],
      root: fileURLToPath(new URL("./", import.meta.url)),
    },
  }),
);
