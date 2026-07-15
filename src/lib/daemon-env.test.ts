import assert from "node:assert/strict";
import test from "node:test";
import { buildDaemonBaseEnvEntries } from "./daemon-env.ts";
import { daemonRepoPath } from "./paths.ts";

test("managed daemon.env must not place TURBOPANEL_DAEMON_STATE_DIR under the daemon checkout", () => {
  const entries = buildDaemonBaseEnvEntries();
  const daemonRepo = daemonRepoPath();
  const stateDir = entries.TURBOPANEL_DAEMON_STATE_DIR;

  assert.ok(
    stateDir === undefined ||
      (!stateDir.startsWith(`${daemonRepo}/`) && stateDir !== daemonRepo),
    `TURBOPANEL_DAEMON_STATE_DIR must not live under the daemon checkout (got ${stateDir})`,
  );
});
