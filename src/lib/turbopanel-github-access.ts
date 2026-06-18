import { resolveDevIdentity } from "@turbopanel/lib/paths.ts";

const TURBOPANEL_HOME = "/opt/turbopanel";
const TURBOPANEL_USER = "turbopanel";
const TURBOPANEL_GROUP = "turbopanel";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function getentHome(user: string): string | null {
  const proc = new Deno.Command("getent", {
    args: ["passwd", user],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  if (!proc.success) {
    return null;
  }
  const parts = new TextDecoder().decode(proc.stdout).trim().split(":");
  return parts[5] ?? null;
}

function gitConfigGlobal(key: string): string {
  const proc = new Deno.Command("git", {
    args: ["config", "--global", key],
    stdout: "piped",
    stderr: "null",
  }).outputSync();
  if (!proc.success) {
    return "";
  }
  return new TextDecoder().decode(proc.stdout).trim();
}

function devSshKeyPresent(home: string): boolean {
  try {
    Deno.statSync(`${home}/.ssh/id_ed25519`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Give the turbopanel service user GitHub SSH access on co-located dev hosts.
 * Ansible clones platform repos as turbopanel; the developer's keys live under
 * their own home directory and are not visible to that user by default.
 */
export async function ensureTurbopanelGithubAccess(): Promise<void> {
  const dev = resolveDevIdentity();
  const devHome = getentHome(dev.user);
  if (!devHome) {
    throw new Error(`Cannot resolve home directory for ${dev.user}`);
  }
  if (!devSshKeyPresent(devHome)) {
    throw new Error(
      `No SSH key at ${devHome}/.ssh/id_ed25519 — run develop.sh or add a GitHub SSH key first`,
    );
  }

  const gitName = gitConfigGlobal("user.name");
  const gitEmail = gitConfigGlobal("user.email");
  if (!gitName || !gitEmail) {
    throw new Error(
      "Git user.name and user.email must be configured before starting the dev stack",
    );
  }

  const sshDir = `${TURBOPANEL_HOME}/.ssh`;
  const devHomeQ = shellQuote(devHome);
  const sshDirQ = shellQuote(sshDir);
  const script = [
    `set -eu`,
    // Avoid the developer's 0700 home as cwd; git as turbopanel can't stat it.
    `cd ${shellQuote(TURBOPANEL_HOME)}`,
    `mkdir -p ${sshDirQ}`,
    `for f in id_ed25519 id_ed25519.pub; do`,
    `  if [ -f ${devHomeQ}/.ssh/"$f" ]; then`,
    `    cp ${devHomeQ}/.ssh/"$f" ${sshDirQ}/"$f"`,
    `  fi`,
    `done`,
    `[ -f ${sshDirQ}/id_ed25519 ] || { echo "missing ${sshDirQ}/id_ed25519 after copy" >&2; exit 1; }`,
    `touch ${sshDirQ}/known_hosts`,
    `if [ -f ${devHomeQ}/.ssh/known_hosts ]; then`,
    `  cat ${devHomeQ}/.ssh/known_hosts >> ${sshDirQ}/known_hosts`,
    `fi`,
    `if command -v ssh-keyscan >/dev/null 2>&1; then`,
    `  ssh-keyscan -t ed25519 github.com >> ${sshDirQ}/known_hosts 2>/dev/null || true`,
    `fi`,
    `cat >${sshDirQ}/config <<EOF`,
    `Host github.com`,
    `  IdentityFile ${sshDir}/id_ed25519`,
    `  UserKnownHostsFile ${sshDir}/known_hosts`,
    `  StrictHostKeyChecking yes`,
    `EOF`,
    `chown -R ${shellQuote(TURBOPANEL_USER)}:${shellQuote(TURBOPANEL_GROUP)} ${sshDirQ}`,
    `chmod 700 ${sshDirQ}`,
    `chmod 600 ${sshDirQ}/id_ed25519 ${sshDirQ}/known_hosts ${sshDirQ}/config`,
    `[ -f ${sshDirQ}/id_ed25519.pub ] && chmod 644 ${sshDirQ}/id_ed25519.pub`,
    `sudo -u ${shellQuote(TURBOPANEL_USER)} env HOME=${shellQuote(TURBOPANEL_HOME)} git config --global user.name ${shellQuote(gitName)}`,
    `sudo -u ${shellQuote(TURBOPANEL_USER)} env HOME=${shellQuote(TURBOPANEL_HOME)} git config --global user.email ${shellQuote(gitEmail)}`,
    `gh_out=$(sudo -u ${shellQuote(TURBOPANEL_USER)} env HOME=${shellQuote(TURBOPANEL_HOME)} ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -T git@github.com 2>&1) || true`,
    `echo "$gh_out" | grep -qiE 'successfully authenticated|Hi .+!?' || { echo "$gh_out" >&2; exit 1; }`,
  ].join("\n");

  const result = await runPrivilegedShellCapture(script);
  if (result.code !== 0) {
    const detail = result.stderr.trim().split("\n").at(-1) ?? "";
    throw new Error(
      detail
        ? `Failed to configure turbopanel GitHub SSH access: ${detail}`
        : "Failed to configure turbopanel GitHub SSH access — turbopanel cannot authenticate to GitHub (check SSH key and known_hosts)",
    );
  }
}

async function runPrivilegedShellCapture(
  script: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  async function attempt(nopass: boolean): Promise<Deno.CommandOutput> {
    const prefix = nopass ? ["-n"] : [];
    return await new Deno.Command("sudo", {
      args: [...prefix, "bash", "-c", script],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  }

  let output = await attempt(true);
  if (!output.success && (output.code ?? 1) === 1) {
    output = await attempt(false);
  }

  return {
    code: output.code ?? 1,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}
