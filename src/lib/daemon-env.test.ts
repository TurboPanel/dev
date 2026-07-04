import assert from "node:assert/strict";
import { buildDaemonBaseEnvEntries } from "./daemon-env.ts";
import { daemonRepoPath } from "./paths.ts";

const entries = buildDaemonBaseEnvEntries();
const daemonRepo = daemonRepoPath();
const stateDir = entries.TURBOPANEL_DAEMON_STATE_DIR;

if (stateDir) {
  assert.ok(
    !stateDir.startsWith(`${daemonRepo}/`) && stateDir !== daemonRepo,
    `TURBOPANEL_DAEMON_STATE_DIR must not live under the daemon checkout (got ${stateDir})`,
  );
}

console.log("daemon-env contract: ok");
