import { spawnSync, type SpawnSyncReturns } from "node:child_process";

type SpawnResult = SpawnSyncReturns<string>;

function spawnFirst(attempts: string[][]): SpawnResult | null {
  for (const cmd of attempts) {
    const result = spawnSync(cmd[0]!, cmd.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.status === 0) {
      return result;
    }
  }
  return null;
}

export function spawnDocker(args: string[]): SpawnResult | null {
  // Try the dev user's own docker access first, then fall back to sudo for the
  // window before the dev user's docker group membership has taken effect.
  return spawnFirst([
    ["docker", ...args],
    ["sudo", "-n", "docker", ...args],
  ]);
}

export function dockerOutputLines(result: SpawnResult): string[] {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return combined
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
