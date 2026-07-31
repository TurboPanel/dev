import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      exclude: ["node_modules/**", "workers/**"],
      coverage: {
        provider: "v8",
        reportsDirectory: "coverage",
        reporter: ["text", "lcov"],
        include: ["src/**/*.ts", "src/**/*.tsx"],
        exclude: ["**/*.test.*"],
      },
    },
  }),
);
