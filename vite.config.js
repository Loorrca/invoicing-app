import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer (React UI) build config. Electron loads this via the main process.
export default defineConfig({
  base: "./",
  plugins: [react()],
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
