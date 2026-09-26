import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const DEV_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(DEV_ROOT, "scripts/enable-trunk-branch-protection.sh");
const ACTIONS_INTEGRATION_ID = 15368;

type Ruleset = {
  name: string;
  target: string;
  bypass_actors: unknown[];
  rules: Array<{ type: string; parameters?: Record<string, unknown> }>;
};

let workdir: string | null = null;
afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  workdir = null;
});

/**
 * Run the real script against a stub `gh` that never touches GitHub: every
 * ruleset lookup answers "not found" and every POST body is written to a
 * file, so the JSON the script would send can be asserted on.
 */
function recordedRulesets(): Map<string, Ruleset[]> {
  workdir = mkdtempSync(join(tmpdir(), "rulesets-"));
  const bin = join(workdir, "bin");
  const out = join(workdir, "out");
  spawnSync("mkdir", ["-p", bin, out]);
  const stub = join(bin, "gh");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env sh",
      "# stub gh: `gh api /repos/<repo>/rulesets --jq ...` -> no existing ruleset;",
      "# `gh api --method POST /repos/<repo>/rulesets --input - --jq .id` -> record body.",
      'case "$*" in',
      '  *"--method POST"*)',
      '    n=$(ls "$OUT_DIR" | wc -l)',
      '    repo=$(printf "%s" "$*" | sed -n "s|.*/repos/\\([^/]*/[^/]*\\)/rulesets.*|\\1|p" | tr "/" "_")',
      '    cat > "$OUT_DIR/$(printf "%03d" "$n")-$repo.json"',
      '    echo 1',
      "    ;;",
      "  *) exit 0 ;;",
      "esac",
    ].join("\n") + "\n",
  );
  chmodSync(stub, 0o755);
  const res = spawnSync("sh", [SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, OUT_DIR: out },
  });
  if (res.status !== 0) throw new Error(`script failed: ${res.stdout}\n${res.stderr}`);
  const byRepo = new Map<string, Ruleset[]>();
  for (const file of readdirSync(out).sort()) {
    const repo = file.replace(/^\d+-/, "").replace(/\.json$/, "").replace("_", "/");
    const body = JSON.parse(readFileSync(join(out, file), "utf8")) as Ruleset;
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), body]);
  }
  return byRepo;
}

function rule(rs: Ruleset, type: string): Record<string, unknown> {
  const found = rs.rules.find((r) => r.type === type);
  if (!found) throw new TypeError(`${rs.name}: no ${type} rule`);
  return found.parameters ?? {};
}

describe("enable-trunk-branch-protection.sh", () => {
  it("passes a shell syntax check", () => {
    const res = spawnSync("sh", ["-n", SCRIPT], { encoding: "utf8" });
    expect(res.status).toBe(0);
  });

  const byRepo = recordedRulesets();
  const repos = [...byRepo.keys()];

  it("targets all five repos", () => {
    expect(repos.sort()).toEqual([
      "TurboPanel/dev",
      "TurboPanel/turbopanel",
      "TurboPanel/turbopaneld",
      "TurboPanel/ui",
      "TurboPanel/website",
    ]);
  });

  for (const [repo, rulesets] of byRepo) {
    const named = (name: string): Ruleset => {
      const rs = rulesets.find((r) => r.name === name);
      if (!rs) throw new TypeError(`${repo}: no ruleset ${name}`);
      return rs;
    };

    describe(repo, () => {
      it("trunk review: PR-only for everyone, squash only, ci-ok is the only check", () => {
        const rs = named("trunk: review and CI");
        expect(rs.bypass_actors).toEqual([]);
        const pr = rule(rs, "pull_request");
        expect(pr.required_approving_review_count).toBe(0);
        expect(pr.require_extra_approval_for_unattributed_changes).toBe(false);
        expect(pr.allowed_merge_methods).toEqual(["squash"]);
        const checks = rule(rs, "required_status_checks");
        expect(checks.strict_required_status_checks_policy).toBe(false);
        expect(checks.required_status_checks).toEqual([
          { context: "ci-ok", integration_id: ACTIONS_INTEGRATION_ID },
        ]);
        expect(rs.rules.some((r) => r.type === "required_linear_history")).toBe(true);
      });

      it("immutable-history rulesets never have a bypass", () => {
        const trunk = named("trunk: immutable history");
        expect(trunk.bypass_actors).toEqual([]);
        expect(trunk.rules.map((r) => r.type).sort()).toEqual(["deletion", "non_fast_forward"]);
        const tags = named("release tags: immutable");
        expect(tags.bypass_actors).toEqual([]);
      });

      it("release tag creation stays admin-only until the Release App exists", () => {
        const rs = named("release tags: creation");
        expect(rs.bypass_actors).toEqual([
          { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" },
        ]);
      });

      if (repo === "TurboPanel/dev") {
        it("dev has no staging/live rulesets", () => {
          expect(rulesets.map((r) => r.name)).not.toContain("staging & live: review and CI");
        });
      } else {
        it("staging & live review: PR-only, merge commits only, ci-ok, no bypass", () => {
          const rs = named("staging & live: review and CI");
          expect(rs.bypass_actors).toEqual([]);
          const pr = rule(rs, "pull_request");
          expect(pr.require_extra_approval_for_unattributed_changes).toBe(false);
          expect(pr.allowed_merge_methods).toEqual(["merge"]);
          const checks = rule(rs, "required_status_checks");
          expect(checks.strict_required_status_checks_policy).toBe(false);
          expect(checks.required_status_checks).toEqual([
            { context: "ci-ok", integration_id: ACTIONS_INTEGRATION_ID },
          ]);
          expect(rs.rules.some((r) => r.type === "required_linear_history")).toBe(false);
          expect(named("staging & live: immutable history").bypass_actors).toEqual([]);
        });
      }
    });
  }
});
