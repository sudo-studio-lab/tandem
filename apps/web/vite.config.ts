import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // TANDEM_MOCK=1: no proxy, so the UI falls back to the in-browser fake server even while a
  // real Tandem is running on 4318.
  server: process.env.TANDEM_MOCK ? {} : { proxy: { "/api": { target: "http://127.0.0.1:4318", changeOrigin: false } } },
});
