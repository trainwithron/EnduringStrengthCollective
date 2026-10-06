import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Lets a test render a real component (renderToStaticMarkup) without the app build.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // .claude/worktrees holds full repo checkouts for agent-spawned
    // background tasks — running this project's own test suite a second
    // (or third) time against whatever's in there just double-counts.
    exclude: ["node_modules/**", ".next/**", ".claude/worktrees/**"],
  },
});
