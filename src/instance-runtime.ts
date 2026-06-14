import {
  bootstrapOrchestration,
  ensureOrchestrationRuntime,
  readInstanceRuntime as readInstanceRuntimeFromEnv,
  runSudo,
  writeDaemonEnv,
} from "@turbopanel/daemon-lifecycle";
import { TURBOPANEL_PLATFORM, TURBOPANEL_ROOT } from "@turbopanel/paths";
import { ensureWorkersDevVars } from "@turbopanel/workers-dev-vars";

const TURBOPANEL_USER = "turbopanel";

export function readInstanceRuntime(): "deno" | "workers" {
  return readInstanceRuntimeFromEnv();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function turbopanelUserExists(): boolean {
  return new Deno.Command("getent", {
    args: ["passwd", TURBOPANEL_USER],
    stdout: "null",
    stderr: "null",
  }).outputSync().success;
}

async function runPostgresSetupWithExpose(exposePort: boolean): Promise<void> {
  const orchestrationDir = `${TURBOPANEL_PLATFORM}/daemon/orchestration`;
  const ansiblePlaybook = `${orchestrationDir}/runtime/venv/bin/ansible-playbook`;
  const ansibleCfg = `${orchestrationDir}/ansible.cfg`;
  const postgresPlaybook = `${orchestrationDir}/playbooks/postgres-setup.yml`;
  const exposeVar = exposePort ? "true" : "false";

  const ansibleInvocation = [
    `env ANSIBLE_CONFIG=${shellQuote(ansibleCfg)}`,
    shellQuote(ansiblePlaybook),
    "-i localhost,",
    "-c local",
    `-e postgres_expose_port=${exposeVar}`,
    shellQuote(postgresPlaybook),
  ].join(" ");

  const command =
    `cd ${shellQuote(orchestrationDir)} && ${ansibleInvocation}`;

  const code = turbopanelUserExists()
    ? await runSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      "bash",
      "-c",
      command,
    ])
    : await runSudo(["bash", "-c", command]);
  if (code !== 0) {
    throw new Error("postgres-setup.yml failed");
  }
}

async function runInstanceLaunchRefresh(): Promise<void> {
  const orchestrationDir = `${TURBOPANEL_PLATFORM}/daemon/orchestration`;
  const ansiblePlaybook = `${orchestrationDir}/runtime/venv/bin/ansible-playbook`;
  const ansibleCfg = `${orchestrationDir}/ansible.cfg`;
  const launchPlaybook =
    `${orchestrationDir}/playbooks/instance-launch-only.yml`;
  const runtime = readInstanceRuntime();

  const ansibleInvocation = [
    `env ANSIBLE_CONFIG=${shellQuote(ansibleCfg)}`,
    shellQuote(ansiblePlaybook),
    "-i localhost,",
    "-c local",
    `-e turbopanel_instance_runtime=${runtime}`,
    `-e postgres_expose_port=${runtime === "workers" ? "true" : "false"}`,
    shellQuote(launchPlaybook),
  ].join(" ");

  const command =
    `cd ${shellQuote(orchestrationDir)} && ${ansibleInvocation}`;

  const code = turbopanelUserExists()
    ? await runSudo([
      "-u",
      TURBOPANEL_USER,
      "env",
      `HOME=${TURBOPANEL_ROOT}`,
      "bash",
      "-c",
      command,
    ])
    : await runSudo(["bash", "-c", command]);
  if (code !== 0) {
    throw new Error("instance-launch-only.yml failed");
  }
}

export async function switchInstanceRuntime(
  target: "deno" | "workers",
): Promise<void> {
  writeDaemonEnv({ TURBOPANEL_INSTANCE_RUNTIME: target });

  await ensureOrchestrationRuntime();
  await bootstrapOrchestration();
  await runPostgresSetupWithExpose(target === "workers");
  await runInstanceLaunchRefresh();

  if (target === "workers") {
    const code = await runSudo(["systemctl", "restart", "turbopanel-instance"]);
    if (code !== 0) {
      throw new Error("failed to start turbopanel-instance (Workers/wrangler)");
    }
    console.log("turbopanel-instance restarted — wrangler dev managed by systemd");
  } else {
    console.log(
      "Stop any separate pnpm dev (wrangler) terminal in platform/instance before using the systemd instance.",
    );
    const code = await runSudo(["systemctl", "start", "turbopanel-instance"]);
    if (code !== 0) {
      throw new Error("failed to start turbopanel-instance");
    }
  }
}
