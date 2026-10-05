#!/usr/bin/env node
// Launch preflight: prints green / amber / red for everything about a release
// that a machine can check. It only READS: GitHub's REST API with GET, and
// public HTTPS downloads. It never touches staging, live, or any server of ours
// unless you ask for --hosted, which does one public GET of each hosted
// /api/health (the same page anyone can open in a browser).
//
//   node scripts/preflight/cli.mjs [--hosted] [--strict] [--no-color]
//
// Exit code: 0 when nothing is red, 1 when something is red (with --strict,
// also when something is amber), 2 when GitHub could not be read at all.
// A GitHub token is taken from GH_TOKEN or GITHUB_TOKEN, else from `gh auth token`; with none, the calls are anonymous
// (rate-limited, and the environments check will say it cannot see them).
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { formatRow, summarise } from "./lib.mjs";
import { runPreflight } from "./run.mjs";

const API = "https://api.github.com";

function findToken(env = process.env, run = execFileSync) {
  const fromEnv = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return run("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** The only two ways out: both are GET. */
export function makeIo(token, doFetch = fetch) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "turbopanel-launch-preflight" };
  if (token) headers.authorization = `Bearer ${token}`;
  return {
    async api(path) {
      const res = await doFetch(`${API}${path}`, { method: "GET", headers });
      if (!res.ok) throw Object.assign(new Error(`GET ${path}: HTTP ${res.status}`), { status: res.status });
      return res.json();
    },
    async download(url) {
      try {
        const res = await doFetch(url, { method: "GET", redirect: "follow", headers: { "user-agent": headers["user-agent"] } });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    },
  };
}

function verdictLine({ ok, goForMerge }) {
  if (goForMerge) return "READY: nothing red, nothing waiting.";
  if (ok) return "NOT YET: nothing red, but something is waiting or unknown (amber).";
  return "STOP: fix the red rows first.";
}

export async function main(argv, out = console.log, io = makeIo(findToken())) {
  const flags = new Set(argv);
  const colour = process.stdout.isTTY === true && !flags.has("--no-color");
  let rows;
  try {
    rows = await runPreflight(io, { hosted: flags.has("--hosted") });
  } catch (error) {
    out(`Preflight could not read GitHub: ${error.message}`);
    return 2;
  }
  for (const r of rows) out(formatRow(r, colour));
  const { counts, ok, goForMerge } = summarise(rows);
  out("");
  out(`green ${counts.green}, amber ${counts.amber}, red ${counts.red}, info ${counts.info}`);
  out(verdictLine({ ok, goForMerge }));
  return ok && (goForMerge || !flags.has("--strict")) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
