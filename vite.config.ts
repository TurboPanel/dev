import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// vite-node config for the Ink TUI. `@vitejs/plugin-react` provides Fast Refresh
// (state-preserving hot reload) in watch mode. Keep the alias in sync with the
// "paths" entry in tsconfig.json.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@turbopanel\/components\//,
        replacement: fileURLToPath(
          new URL("./src/components/", import.meta.url),
        ),
      },
    ],
  },
});
