import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { turbopanelUserExists } from "./turbopanel-permissions.ts";

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

export function spawnAsTurbopanel(args: string[]): SpawnResult | null {
  if (!turbopanelUserExists()) {
    return null;
  }
  return spawnFirst([["sudo", "-n", "-u", "turbopanel", ...args]]);
}

export function spawnDocker(args: string[]): SpawnResult | null {
  const attempts: string[][] = [["docker", ...args]];
  if (turbopanelUserExists()) {
    attempts.push(["sudo", "-n", "-u", "turbopanel", "docker", ...args]);
  }
  attempts.push(["sudo", "-n", "docker", ...args]);
  return spawnFirst(attempts);
}

export function dockerOutputLines(result: SpawnResult): string[] {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return combined
    .split("\n")
    .filter((line) => line.trim().length > 0);
}
