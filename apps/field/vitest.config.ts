import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// First-ever test setup for apps/field (Phase 4 Operations Frontend,
// approved Decision 4). Mirrors apps/web's own vitest.config.ts exactly —
// same runtime, same alias convention — even though this app's source uses
// relative imports rather than "@/..." internally; the alias is here so new
// field code and its tests can adopt the same "@/..." convention apps/web
// already uses, without a forced rename of the existing three files.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
