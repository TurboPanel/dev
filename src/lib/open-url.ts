import { spawnSync } from "node:child_process";

export function openUrlInBrowser(url: string): boolean {
  const attempts = [
    ["xdg-open", url],
    ["sensible-browser", url],
    ["wslview", url],
  ] as const;

  for (const cmd of attempts) {
    const result = spawnSync(cmd[0], [cmd[1]], {
      encoding: "utf8",
      stdio: "ignore",
    });
    if (result.status === 0) {
      return true;
    }
  }

  return false;
}

export function isHttpListening(url: string, timeoutSec = 1): boolean {
  const args = [
    "-s",
    "--max-time",
    String(timeoutSec),
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
  ];
  if (url.startsWith("https://")) {
    args.push("-k");
  }
  args.push(url);

  const result = spawnSync("curl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const code = Number((result.stdout ?? "").trim());
  return Number.isFinite(code) && code > 0 && code < 500;
}
