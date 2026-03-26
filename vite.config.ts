import { defineConfig } from "vite";
import { resolve } from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: "src",
  publicDir: "../public",
  clearScreen: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/index.html"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
