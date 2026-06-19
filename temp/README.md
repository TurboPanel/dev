# Legacy archive (pre-console refactor)

The full multi-screen Ink console was removed during a minimal rewrite. Its source lives here for reference while features are rebuilt incrementally.

| Path | Contents |
|------|----------|
| `legacy-src/` | Previous `src/` tree (Ink UI, hooks, lib, orchestration glue) |
| `legacy-scripts/` | Previous `scripts/` tree (`develop.sh`, `lib/`, patches, orchestration runner) |

## Current console layout

| Path | Purpose |
|------|---------|
| `src/tui.tsx` | Ink entrypoint — minimal success screen after bootstrap |
| `./console` | Prerequisite check, pinned Deno install, dependency cache, `deno run --allow-all src/tui.tsx` |
| `scripts/develop.sh` | Clone/update checkout, then `exec ./console` |
| `deno.json` | Deno tasks and imports (`dev`, `console:watch`, `cache` all target `src/tui.tsx`) |

Restore from `legacy-src/` or `legacy-scripts/` as features are reintroduced.
