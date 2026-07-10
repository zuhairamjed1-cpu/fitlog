import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
        },
      },
    },
  },
  // Vitest: only the real suites live under src/. jsdom gives tests a DOM +
  // localStorage (the fdcResolver cache test needs it). tests/engines.test.mjs is
  // a standalone `node` harness, not a vitest suite, so it's intentionally excluded.
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{js,jsx,ts,tsx}"],
  },
});
