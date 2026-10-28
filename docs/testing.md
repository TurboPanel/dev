# Testing Details

Maintainer reference moved out of the root `AGENTS.md` (Testing).

**Cross-repo pin tests** (`dev-converge-email-settings.test.ts`,
`paths.test.ts` Deno pin, `stack-versions.pins.test.ts`) read sibling
checkouts through `siblingCheckout()` (`src/lib/sibling-checkout.ts`):
`<dev>/../<repo>` locally, `TURBOPANEL_SIBLINGS_DIR/<repo>` in CI. They skip
when a sibling is absent, except where `TURBOPANEL_REQUIRE_SIBLINGS=1` —
`verify.yml` clones the four siblings at trunk into `$RUNNER_TEMP/siblings`
and sets both, so in CI a missing sibling fails instead of skipping. CI also
runs `sh scripts/scan-secrets.sh --all` (every tracked file; the pre-commit
hook scans staged files only). There is no linter configured in this repo.
`scripts/scan-secrets.sh`, `scripts/scan-secrets.patterns` and `scripts/scan-secrets.selftest.sh` are byte-identical in turbopanel, turbopaneld, ui, website and dev: change all five together (each repo keeps a copy because the pre-commit hook runs it locally). The rules in the patterns file cover private key blocks, vendor tokens, JWTs, connection URLs with credentials, secret-looking assignments and forbidden file names (dotenv files, `*.pem`, `*.key`, daemon identity files, …); the scanner reports the rule id and location, never the matching text. `--all` scans the tree; `--range BASE..HEAD` scans every line the PR's commits added, so a secret added and removed inside a PR is still caught (CI runs it on PRs into trunk). Allowlist entries in `.secretscan-allowlist` are `path:full line text` (or `@path exact/file` for a forbidden file name), each needs a `# reason:` comment above it, and wildcards are rejected. The self-test builds its fixtures at run time from fragments; dev's `src/lib/scan-secrets.test.ts` runs it and, with the siblings checked out in dev CI, fails if any copy drifts.

Interactive: `vagrant ssh`, then `cd ~/dev` (or `~/turbopaneld` /
`~/turbopanel` / `~/ui` / `~/website`) and the same commands.

Guest commands:

| Command | Purpose |
| ------- | ------- |
| `pnpm test` | Vitest once (`vitest run`) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm test:coverage` | Vitest + LCOV (`coverage/lcov.info`) |
| `pnpm verify:ci` | GitHub Actions `verify.yml` minus Sonar upload (vocabulary + notices + typecheck + LCOV) |
| `./scripts/ci-verify.sh` | Same job for every sibling checkout (guest; re-execs via `vagrant ssh` from the host) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm notices:generate` | Write `THIRD_PARTY_NOTICES.md` from the resolved pnpm graph |
| `pnpm notices:check` | Fail when notices are stale vs the lockfile, or a production dependency has an unreviewed license class |
| `pnpm check:vocabulary` | Reject daemon-as-agent and marketing-phrase copy (`scripts/check-vocabulary.mjs`; same phrase list as the sibling repos) |


**Shared test helpers:** this repo has no local shared test-helper module. Daemon test authors must use the shared doubles in `../turbopaneld/src/testing/` instead of hand-rolled ones (see that repo’s Testing section).

**Pre-commit** (`.githooks/pre-commit`): runs `scripts/scan-secrets.sh` only
(never skippable). Typecheck/tests are **temporarily disabled** in the hook
until the toolchain can run inside the Vagrant guest (host VirtFS checkouts
often lack a usable Node/pnpm tree). CI `verify.yml` still gates PRs.
`./console` idempotently sets `core.hooksPath=.githooks` via
`tp_ensure_git_hooks_path` in `scripts/lib/git-github-ssh.sh`.

**Gate matrix** (one policy with the daemon repo):

| Stage | dev | daemon | Rationale |
| ----- | --- | ------ | --------- |
| pre-commit | scan-secrets only (tests deferred) | scan-secrets + `deno fmt` (lint/tests deferred) | secret scan always; daemon fmt via host Deno or `vagrant ssh`; suites in CI / guest |
| PR → `trunk` | `verify.yml` (`ci-ok` needs `verify`) | `verify.yml` | blocks merge; `ci-ok` is the one context the rulesets will require — add any new PR-time job to its `needs:` |
| push `trunk` | `verify.yml` | `verify.yml`; `publish` job `needs: verify` | nothing compiles from failing code |
| promote → rc/release | the four shipping repos' `promote.yml` (dev has none: it is always run from trunk) | `promote.yml` → `gh-promote.yml` here: **signature + sha256/size of the tested build, re-signed manifest, same bytes** | no new code enters after publish |
