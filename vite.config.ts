import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev server port and relative asset paths.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // tsconfig.json's "@/*" path is TypeScript-only — Vite's own resolver
    // needs this alias too, or every "@/..." import fails at dev/build time
    // even though the files it points to are real.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Companion sprite sheets live in /assets (project root, per architecture.md,
  // since Rust also reads that folder directly for manifest validation) rather
  // than the conventional /public. Pointing Vite's publicDir there — instead of
  // duplicating the files under public/ — means the same files are both the
  // single source of truth for Rust's validator and are served at /companions/...
  // by the dev server and copied into the production build unchanged.
  publicDir: fileURLToPath(new URL("./assets", import.meta.url)),
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri v2 exports TAURI_ENV_PLATFORM / TAURI_ENV_DEBUG (v1's TAURI_PLATFORM /
    // TAURI_DEBUG are never set any more, so the old names silently selected the
    // safari13 branch on every OS and ignored debug builds). Windows ships WebView2
    // (Chromium); macOS and Linux ship WebKit.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
