import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["graph-snapshots/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: [".claude/**", "**/node_modules/**", "vendor/**"],
  },
});
