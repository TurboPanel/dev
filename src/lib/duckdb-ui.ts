import type { InstallOutputHandler } from "./install-output.ts";
import { isDeveloperSurfaceInstance, readInstanceRuntime } from "./daemon-env.ts";
import { startDuckdbUi } from "./developer-client.ts";
import { openUrlInBrowser } from "./open-url.ts";
import { duckdbUiBrowserUrl } from "./service-urls.ts";

/**
 * Developer → Open DuckDB UI (metrics): on-demand, developer-surface-only.
 *
 * Unlike the optional dev services this is not a unit toggle — there is no
 * container or systemd unit. The instance's own embedded DuckDB serves the UI
 * (`POST /api/developer/v1/metrics/duckdb-ui` runs `LOAD ui` +
 * `start_ui_server()` on the live store connection), so the browser attaches
 * to the single writer; we then open the loopback URL (:4213). Only the
 * developer-surface build (`src/deno-dev.ts`) mounts that route — compiled
 * and static Deno builds run `src/deno.ts` and must reject up front.
 */
export async function openDuckDbUi(
  onOutput?: InstallOutputHandler,
): Promise<void> {
  if (readInstanceRuntime() === "workers") {
    throw new Error(
      "DuckDB UI is unavailable when the instance runtime is Workers — switch to Deno runtime",
    );
  }
  if (!isDeveloperSurfaceInstance()) {
    throw new Error(
      "DuckDB UI requires the developer-surface instance build (source run mode, dev UI mode) — compiled and static builds do not mount the developer API",
    );
  }

  onOutput?.("Starting embedded DuckDB UI via the instance developer API…");
  const response = await startDuckdbUi();
  if (!response.ok) {
    throw new Error(response.error ?? "Failed to start the DuckDB UI");
  }

  const url = duckdbUiBrowserUrl();
  onOutput?.(`DuckDB UI ready at ${url}`);
  if (!openUrlInBrowser(url)) {
    onOutput?.(`Open ${url} in your browser`);
  }
}
