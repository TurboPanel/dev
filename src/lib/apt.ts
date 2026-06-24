import { type InstallOutputHandler, runCaptured } from "./install-output.ts";

/**
 * Seconds apt-get waits for the dpkg/frontend lock before giving up. Covers both
 * concurrent console apt calls and external holders (unattended-upgrades,
 * apt-daily) that commonly run right after a fresh Debian boot.
 */
const APT_LOCK_TIMEOUT_SECONDS = 300;

const APT_LOCK_OPTION = `-o DPkg::Lock::Timeout=${APT_LOCK_TIMEOUT_SECONDS}`;

// Serialize every apt-get the console runs so we never race ourselves for the
// dpkg lock (e.g. the launch-time permission refresh vs. the daemon bootstrap).
let aptChain: Promise<unknown> = Promise.resolve();

function serializeApt<T>(task: () => Promise<T>): Promise<T> {
  const run = aptChain.then(task, task);
  aptChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface AptGetInstallOptions {
  /** Run `apt-get update` before installing. */
  update?: boolean;
}

/**
 * Install Debian packages via sudo apt-get. Calls are serialized in-process and
 * use `DPkg::Lock::Timeout` so a held dpkg lock waits instead of failing.
 */
export async function aptGetInstall(
  packages: string[],
  onOutput?: InstallOutputHandler,
  options: AptGetInstallOptions = {},
): Promise<number> {
  return serializeApt(() => {
    const pkgs = packages.map(shellQuote).join(" ");
    const install =
      `DEBIAN_FRONTEND=noninteractive apt-get ${APT_LOCK_OPTION} install -y ${pkgs}`;
    const script = options.update
      ? `DEBIAN_FRONTEND=noninteractive apt-get ${APT_LOCK_OPTION} update -qq && ${install}`
      : install;
    return runCaptured(["sudo", "-n", "sh", "-c", script], onOutput);
  });
}
