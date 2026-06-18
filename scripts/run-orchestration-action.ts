#!/usr/bin/env -S deno run --config=/opt/turbopanel/platform/daemon/deno.json --allow-read --allow-run --allow-env --allow-write --allow-net
/**
 * Runs daemon orchestration playbooks as turbopanel (invoked via sudo from the console).
 * Emits Ansible JSONL events on stdout — one JSON object per line.
 *
 * Uses the daemon checkout's Deno config so @std/* imports in the orchestration
 * module graph resolve the same way as daemon bootstrap.
 */
import {
  ANSIBLE_COLLECTIONS_PATH,
  ANSIBLE_LOCAL_TMP,
  ANSIBLE_PLAYBOOK_BIN,
  TURBOPANEL_PLATFORM,
} from "../src/lib/paths.ts";

const DAEMON_ANSIBLE_EVENTS_PATH =
  `${TURBOPANEL_PLATFORM}/daemon/src/orchestration/ansible-events.ts`;
const DAEMON_ANSIBLE_PATH =
  `${TURBOPANEL_PLATFORM}/daemon/src/orchestration/ansible.ts`;
const DAEMON_ORCHESTRATION_DIR =
  `${TURBOPANEL_PLATFORM}/daemon/orchestration`;

function ansiblePlaybookEnv(): Record<string, string> {
  return {
    ANSIBLE_CONFIG: `${DAEMON_ORCHESTRATION_DIR}/ansible.cfg`,
    ANSIBLE_LOCAL_TEMP: ANSIBLE_LOCAL_TMP,
    ANSIBLE_COLLECTIONS_PATH: ANSIBLE_COLLECTIONS_PATH,
  };
}

function emitEvent(event: unknown): void {
  console.log(JSON.stringify(event));
}

function usage(): never {
  console.error(
    "Usage: run-orchestration-action.ts <instance-dev-install|build-toggle|playbook> [args…]",
  );
  Deno.exit(2);
}

async function runInstanceDevInstall(): Promise<void> {
  const mod = await import(DAEMON_ANSIBLE_PATH) as {
    runInstanceDevInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
  };
  await mod.runInstanceDevInstall(emitEvent);
}

async function runBuildToggle(): Promise<void> {
  const raw = Deno.args[1];
  if (!raw) {
    throw new Error("build-toggle requires a JSON options argument");
  }
  const opts = JSON.parse(raw) as {
    uiMode: "dev" | "static";
    instanceRunMode: "source" | "compiled";
    forceBuild?: boolean;
  };
  const mod = await import(DAEMON_ANSIBLE_PATH) as {
    runBuildToggle: (
      opts: {
        uiMode: "dev" | "static";
        instanceRunMode: "source" | "compiled";
        forceBuild?: boolean;
      },
      onEvent?: (event: unknown) => void,
    ) => Promise<void>;
  };
  await mod.runBuildToggle(opts, emitEvent);
}

async function runPlaybook(): Promise<void> {
  const playbookRelative = Deno.args[1];
  if (!playbookRelative) {
    throw new Error("playbook requires a playbook path argument");
  }
  const extraArgs = Deno.args.slice(2);
  const eventsMod = await import(DAEMON_ANSIBLE_EVENTS_PATH) as {
    runPlaybookStreaming: (
      ansiblePlaybookBin: string,
      args: string[],
      options: {
        cwd?: string;
        env?: Record<string, string>;
        onEvent: (event: unknown) => void;
      },
    ) => Promise<void>;
  };
  const playbook = `${DAEMON_ORCHESTRATION_DIR}/playbooks/${playbookRelative}`;
  await eventsMod.runPlaybookStreaming(
    ANSIBLE_PLAYBOOK_BIN,
    ["-i", "localhost,", "-c", "local", ...extraArgs, playbook],
    {
      cwd: DAEMON_ORCHESTRATION_DIR,
      env: ansiblePlaybookEnv(),
      onEvent: emitEvent,
    },
  );
}

const action = Deno.args[0];
if (!action) {
  usage();
}

try {
  switch (action) {
    case "instance-dev-install":
      await runInstanceDevInstall();
      break;
    case "build-toggle":
      await runBuildToggle();
      break;
    case "playbook":
      await runPlaybook();
      break;
    default:
      usage();
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  Deno.exit(1);
}
