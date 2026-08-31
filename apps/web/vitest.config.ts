import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// First-ever frontend test setup for apps/web (Phase 5 Step 5). Deliberately
// separate from apps/api's Jest config — a different package, a different
// runtime (jsdom vs. Node), no shared config to fight over.
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
