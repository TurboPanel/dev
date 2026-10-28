# CI, Releases and Rulesets (`.github/`) — AGENTS.md

Repo context: `../AGENTS.md`.

## Release promotion (`gh-promote.yml`, `gh-release.yml`, `gh-promote-finalize.yml`)

The one-click promotion every repo runs (Testing Checklist `release` section, rel-s19..s21) lives here as three reusable workflows; each sibling's `.github/workflows/promote.yml` (`workflow_dispatch`, inputs `to` = `rc|release`, `source`) chains them as three `uses:` jobs pinned to one `TurboPanel/dev@<sha>` and passes that same sha as `dev-ref` (a reusable workflow cannot call another at a parameterised ref, and it runs on the caller's runner with nothing checked out — `dev-ref` is how it finds `scripts/promote/`). Repos release independently: no release waits on a matching release in another repo. dev itself has no rc or release: the consoles run trunk, and the sibling repos pin `TurboPanel/dev@<sha>`, never a release tag (its `promote.yml` / `release.yml` were removed 2026-09-29).

- **Version model** (decisions D8, 2026-09-28, amended 2026-09-29; Phase 3 "versions from tags", 2026-09-30; committed version files again, 2026-10-12): **git tags work out every number, and the committed version files must agree.** A repo's base is its newest release tag's next patch (`v0.1.5` → `0.1.6`), unless an unreleased `v<B>-rc.N` tag or a `start/v<B>` marker names a higher B (then that B). A canary is `<base>-canary.<N>`, N one past the highest `manifest-<base>-canary.*.json` on the rolling canary release, so N restarts at 1 for each base (builds cut before Phase 3 carry the workflow run number; the version in flight when Phase 3 landed continues from it). Only the base is stamped into the binaries (deno.json / package.json / app.json are overwritten in the CI workspace before the build). The committed numbers are kept current too: each shipping repo has `scripts/set-version.mjs` (`node scripts/set-version.mjs X.Y.Z` rewrites them, `--check X.Y.Z` lists the files that disagree), and its canary build runs the check right after Version From Tags and is refused while trunk's files disagree with the base. Who moves them: right after each release, the repo's `publish-release.yml` has the TurboPanel Release App open a **"chore: start X.Y.Z"** PR (the next patch) through the **Start Version PR** action (`.github/actions/start-version-pr`, core `scripts/promote/version-pr.sh`; inputs `version`, `github-token`, `repository`, `set-version`, `reason`, `auto-merge` (default `"false"`); output `pr-url`, empty when the repo is already at X.Y.Z, the open PR's url when one is already open). Its commit is made with the GraphQL `createCommitOnBranch` mutation, which takes no author, so GitHub signs it and it shows as Verified; nothing is `git push`ed. The branch is `version/X.Y.Z` off trunk's head (reset when it was left over without an open PR). With `auto-merge: "true"` the PR merges itself once its checks pass (GitHub auto-merge, squash, titled by the PR; if GitHub refuses, the step only warns and a person merges it); Start Next Version always turns it on. Until it merges, that repo's canaries are refused. `to=rc` makes `<base>-rc.<N>` where `<N>` is one past the highest existing `v<base>-rc.*` tag (a bad rc is fixed on trunk and the next promotion cuts rc.N+1 — the number stays until it ships); `to=release` makes `<base>` from the newest rc that has not shipped. The rules are `nextBase` / `nextCanaryNumber` / `newestUnreleasedRc` / `startTarget` in `scripts/promote/lib.mjs`; `scripts/promote/version.sh` runs them against a repo's tags and canary release, and the composite action `.github/actions/version` (**Version From Tags**, pinned by sha like the reusable workflows) is how the sibling repos call it. Builds cut before 2026-09-28 keep their old timestamped canary spelling and are still read: `to=rc` accepts either canary spelling as `source`, and the canary prune orders counter builds numerically after all timestamped ones.
- **`gh-promote.yml` (prepare, `environment: ${{ inputs.to == 'release' && 'release' || (inputs.repo-kind != 'notes-only' && 'rc' || null) }}`)** — inputs `repo-kind` (`daemon|instance|ui|notes-only`), `to`, `source` (rc: canary version or `manifest-<version>.json` — a bare build number is ambiguous once N restarts per base; notes-only: a commit-ish, versioned with the repo's base; release: the rc tag), `dev-ref`, `signer-ref` (turbopaneld commit with `scripts/sign-manifest.ts` + the key pin), `approval-environment` (ignored, kept so old callers that pass it keep working; the environment follows `to`: rc runs in `rc` — no reviewer, branch `staging` — and release in `release`, the owner-approval gate on `live`); secrets `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY`; outputs `version`, `tag`, `commit`, `source-version`, `branch`, `assets-artifact-name`, `manifest-filename`, `release-notes`. It downloads the source build (rc: the assets the canary `manifest-<version>.json` copy names; release: the rc release), verifies the manifest's Ed25519 signature with the signer checkout's own `verifyManifestSignature` (`scripts/promote/verify-signature.ts`) and every asset's sha256/size, refuses an rc while `.changeset/*.md` are pending at the source commit (no `.changeset/` → notice + skip), renames the assets to the target version, rewrites the manifest (version, channel, tag-pinned urls; commit/buildId/builtAt/sha256 untouched; signature dropped), signs it with `sign-manifest.ts`, creates the tag at the source commit (idempotent — an existing tag on another commit is a burned version and fails), and uploads the assets. `to=release` refuses to start without the App secrets: bare `v<base>` tags and `staging`/`live` pushes need the **TurboPanel Release** GitHub App as ruleset bypass actor; `v<base>-rc.1` is created with `GITHUB_TOKEN` (fires no workflows). Every falsifiable check runs before the tag step (`src/lib/promote.test.ts` asserts the order).
- **`gh-release.yml`** — unchanged behaviour plus `target-commit` (tag commit when the tag does not exist; default `github.sha`) and optional App secrets (release created with an App token when set).
- **`gh-promote-finalize.yml` (no environment — the one approval is at prepare)** — release: `gh release edit --prerelease=false --latest`, then the signed release `manifest.json` is uploaded as the rolling `rc` pointer (consumers do not enforce `manifest.channel`; no second signing). Both hops: fast-forward `staging` (rc) / `live` (release) to the tag commit; a diverged branch gets a `--no-ff` merge commit (never squash, never force) and the run summary says so; without the App the push step fails and its run summary prints the manual route — push `promote/v<version>` at the tag commit, open a PR into the branch as the owner (a GITHUB_TOKEN PR never starts `ci-ok`), merge it with a merge commit once `ci-ok` is green (direct pushes to staging/live are refused for everyone).
- **`scripts/promote-release.sh`** — the manual override, kept on purpose: it re-verifies a pre-release's assets against its own `manifest.json` and then runs `gh release edit --prerelease=false`. The normal flow never calls it (`gh-promote-finalize.yml` does the same move); use it only when that automation cannot run.
- **Pure logic** is `scripts/promote/lib.mjs` (+ `lib.d.mts`, `cli.mjs`), tested by `src/lib/promote.test.ts`, which also pins the workflow shapes.
- **`scripts/promote/changelog.sh`** — the credit list: one markdown line per commit between two refs (`<owner/repo> <base> <head>`), the squash-merge title (with its PR number), then the author's avatar and name (no `@`, linked to their profile) after the text, then a "Thanks to" line crediting each contributor once. `gh-promote.yml` appends it to the release notes (since the last non-pre-release release, under "What changed"); the repos' candidate and release pull-request bodies use the same shape. Notes reach `gh release create` through the `RELEASE_NOTES` environment variable, never pasted into shell text (commit titles and HTML must not be parsed as shell).
- **Starting a minor or major** — the daemon repo's **Start Next Version** workflow (`turbopaneld/.github/workflows/start-next-version.yml`, `workflow_dispatch`, inputs `bump` = `minor|major` and `dry-run`; the logic is `scripts/promote/start-version.sh` here) pushes an annotated `start/v<X.Y.0>` marker tag (Release App token) at trunk's head in turbopaneld, turbopanel, ui and website — each repo's target is the next minor/major after *its own* newest release; a repo already building a later version is skipped, and one already building exactly the target only gets its PR retried — and then opens that repo's "chore: start X.Y.0" PR with the same `version-pr.sh` (it no longer re-runs the trunk build: the canary check would refuse it until the PR merges). The `<owner/repo>:<workflow>` arguments still work; the workflow part is now ignored. Only people with write access can run a `workflow_dispatch`. Repos still release independently: nothing waits on another repo's release (the old `minor-gate` check, the `minor` label and the old "Start <next>" PR workflows are gone; `src/lib/workflows.test.ts` fails if a workflow brings them back; the "chore: start X.Y.Z" PR above replaces them). Once a marker is pushed, every later release of that repo — a hotfix included — carries the new number.
- **Owner-side setup**: a `release` environment (required reviewer = owner, prevent-self-review off) in every calling repo as the one approval gate; `TURBOPANEL_RELEASE_SIGNING_KEY` as an ENVIRONMENT secret holding the same value in the `canary` (branch trunk, no reviewer), `rc` (branch staging, no reviewer) and `release` (branch live, owner reviewer) environments of each signing repo (no repo-level copy; break-glass `promote.yml` is dispatched from staging for to=rc and live for to=release), and `RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY` (org secrets, all repos) as plain Actions secrets (one approval per promotion); the App as bypass actor on the tag ruleset and `staging & live: review and CI` (`RELEASE_APP_BYPASS` in `scripts/enable-trunk-branch-protection.sh`). One approval per promotion (prepare).

## CI Gates

### SonarQube (CI-based analysis)

- Analysis runs in GitHub Actions (`.github/workflows/verify.yml`) with
  `SONAR_TOKEN` and `sonar-project.properties`
  (`sonar.projectKey=turbopanel_dev`, `sonar.organization=turbopanel`). The job
  runs `check:vocabulary`, `notices:check`, typecheck, and **`pnpm test:coverage`** (Vitest v8 LCOV at
  `coverage/lcov.info`), then scans with
  `sonar.javascript.lcov.reportPaths=coverage/lcov.info`. The scan waits on the
  quality gate (`sonar.qualitygate.wait=true`); if the gate fails, the workflow
  stops.
- Vitest coverage `include` is `src/lib/**/*.ts` and `src/hooks/**/*.ts`
  (`vitest.config.ts`). `sonar.coverage.exclusions` keeps Ink chrome
  (`src/components/**`, `**/*.tsx`), entrypoints, and spawn/integration helpers
  out of the coverage denominator so untested TUI surfaces do not fail Sonar-way
  **Coverage on New Code ≥ 80%**.
- **`sonar.sources` / `sonar.tests` / `sonar.test.inclusions`** must stay set in
  `sonar-project.properties` (and mirrored in vestigial
  `.sonarcloud.properties`). Tests are co-located (`**/*.test.ts` under `src`).
- **Automatic Analysis must stay off** for `turbopanel_dev` (SonarCloud →
  project **Administration → Analysis Method**). CI and Automatic Analysis
  cannot run together — Automatic Analysis enabled makes the CI scanner fail.

**Coverage:** SonarCloud’s Sonar-way quality gate (CI scan in `.github/workflows/verify.yml` with `sonar.qualitygate.wait=true`) requires **≥ 80% coverage on new code**. CI uploads Vitest LCOV from `pnpm test:coverage` (`coverage/lcov.info`); `SONAR_TOKEN` is required on same-repo PRs and trunk pushes. After switching from Automatic Analysis, reset **New Code** (Administration → New Code) so the baseline is not months of uncovered history. Sibling repos (`turbopanel`, `ui`, `website`) use the same CI-based Sonar + LCOV pattern in their own `verify.yml` workflows.

### Dependency advisories (`.github/actions/osv-scan`)

Every repo's `verify` runs the **Dependency Advisory Gate** composite action
(dev itself as `./.github/actions/osv-scan`, the siblings pinned by sha like
the reusable workflows). It installs the pinned, checksum-verified osv-scanner
and runs `scripts/osv/scan.sh`, which fails **only** for an advisory rated HIGH
or CRITICAL (CVSS ≥ 7.0 or a HIGH/CRITICAL database label) that already has a
fixed version (`scripts/osv/gate.jq`). Anything else — lower severity, unrated,
or no fix yet — is a warning annotation on the run, not a red X (owner decision
2026-09-30: a newly published advisory must not freeze every unrelated PR).
**Override** for a blocking advisory verified not exploitable in that repo: an
`[[IgnoredVulns]]` entry in the repo's `osv-scanner.toml` with `id`, a written
`reason`, and `ignoreUntil` when a fix is expected (see ui/website for the
format). Bumping the scanner is one edit here plus a re-pin in the siblings.
Tests: `src/lib/osv-scan-script.test.ts`.

### No new Sonar issues (`.github/actions/sonar-new-issues`)

Owner rule (2026-09-30): a pull request may not add a single Sonar issue. The
built-in **Sonar way** gate fails only on ratings, so one new code smell (a
nested ternary, say) still passes it, and custom gates need a paid SonarCloud
plan. So every repo's `verify` runs this composite action (dev as
`./.github/actions/sonar-new-issues`, the siblings pinned by sha) right after
its pull-request **SonarQube Scan** step, which carries `id: sonar` and
already waited for the gate. The step's condition is
`github.event_name == 'pull_request' && steps.sonar.outcome == 'success'`, so it
runs exactly where the PR scan ran and skips wherever the scan is skipped (no
token, and the automatic promotion PRs into staging/live).
`scripts/sonar/new-issues.sh` asks SonarCloud's public API for the PR's
unresolved issues, annotates each one on its file and line, and fails when
there are any. It fails closed when SonarCloud has no analysis for the PR or
keeps erroring. `SONAR_TOKEN`, when set in the job, goes to curl through a
config on stdin, never argv. Never NOSONAR to get past it; fix the issue.
Tests: `src/lib/sonar-new-issues-script.test.ts`.

## Repository rulesets

`scripts/enable-trunk-branch-protection.sh` is the source of truth for every
GitHub ruleset on the five repos (upsert by name; re-run to change). It makes
`trunk`, `staging` and `live` PR-only for everyone — no human bypass, zero
required approvals, one required check `ci-ok` pinned to the GitHub Actions
app (integration id 15368), squash-only on trunk and merge-commits-only on
staging/live, `require_extra_approval_for_unattributed_changes` explicitly
false. Break-glass is flipping a ruleset's enforcement to Disabled in the repo
settings, pushing, and re-enabling. The "TurboPanel Release" GitHub App
(App ID 5089081, `RELEASE_APP_BYPASS`) is the only bypass: on `staging & live:
review and CI` (promotion fast-forwards) and, next to repository admins, on
bare `vX.Y.Z` tag creation. Do not apply a version that requires `ci-ok` before
that job runs on trunk in every repo, or every PR blocks.
`src/lib/branch-protection-script.test.ts` runs the script against a stub `gh`
and asserts the JSON it would send.
