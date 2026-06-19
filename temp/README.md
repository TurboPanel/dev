# Legacy archive (pre-console refactor)

The full multi-screen Ink console was removed during a minimal rewrite. Its source lives here for reference while features are rebuilt incrementally.

| Path | Contents |
|------|----------|
| `legacy-src/` | Previous `src/` tree (Ink UI, hooks, lib, orchestration glue) |
| `legacy-scripts/` | Previous `scripts/` tree (`develop.sh`, `lib/`, patches, orchestration runner) |

## Current console layout

The console now runs on **Node via Vite (`vite-node`)**, not Deno. (Deno is still installed by `./console` because the daemon and instance use it.)

| Path | Purpose |
|------|---------|
| `src/tui.tsx` | Ink entrypoint — full-height shell (menu bar / bordered panel / status bar) |
| `src/components/` | `MenuBar`, `AreaTabs`, `MainPanel`, `StatusBar` |
| `./console` | Prerequisite check, pinned Node + Deno install, `pnpm install`, launch via `vite-node` (`--watch` uses `scripts/hot-reload.tsx` for live reload) |
| `scripts/develop.sh` | Clone/update checkout, then `exec ./console` |
| `package.json` / `vite.config.ts` / `tsconfig.json` | Node/pnpm/Vite project config (`pnpm dev`, `pnpm dev:watch`) |

Restore from `legacy-src/` or `legacy-scripts/` as features are reintroduced.
