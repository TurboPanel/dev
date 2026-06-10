# turbopanel-dev

## Project overview

TurboPanel is a self-hosted server management panel. This `dev` repository is the starting point for contributors — it bootstraps all sibling repositories and provides the tooling needed to run the full stack locally.

Local dev replicates the **Cloudflare Workers** deployment path: the instance runs via **`pnpm dev`** (`wrangler dev`) in `instance/`, the UI via Expo, and **Caddy** terminates TLS and routes traffic — same surface as production Workers, without Deno or systemd.

## Prerequisites

**You are responsible for installing these runtimes on your machine before running the bootstrap script.** The setup script checks that each tool is present and meets the minimum version, but it does not install them for you.

| Tool | Minimum version | Install |
|------|-----------------|---------|
| Node.js | 24.x | https://nodejs.org |
| pnpm | 11.x | https://pnpm.io/installation |
| Docker | latest stable (daemon must be running) | https://docs.docker.com/get-docker/ |
| Tilt | latest stable | https://docs.tilt.dev/install.html |

## Getting started

**One-liner (fresh machine):**

```bash
curl -fsSL https://develop.trbp.nl | bash
```

**If you have already cloned this repo:**

```bash
bash src/develop/idempotent.sh
```

After sibling repos are present, configure local dev env and start orchestration from the `dev/` checkout:

```bash
cp .env.example .env   # edit SESSION_SECRET and other values if needed
tilt up
```

Tilt loads `dev/.env`, syncs derived files into sibling repos (`instance/.dev.vars`, `instance/.env`, `docker/.env`), then starts **Postgres**, the **Workers instance** (`pnpm dev` / wrangler), **Expo web**, and **Caddy** as the HTTPS entrypoint.

| Service | URL |
|---------|-----|
| App (Caddy → UI + API) | https://localhost:8443 |
| API health | https://localhost:8443/api/health |
| Wrangler (direct, internal) | http://localhost:18787 |

Trust the generated platform CA at `instance/certs/ca.crt` in your browser to avoid TLS warnings (run `tilt up` once so `instance-certs` generates it).

Smoke test:

```bash
curl -k https://localhost:8443/api/health
curl -k https://localhost:8443/api/client/v1/install/status
```

### Cursor / VS Code Ports panel

Caddy runs **in Docker** with `127.0.0.1:8443` published (same as Postgres on 5432), so Cursor should auto-forward **8443** via `docker-proxy`. Wrangler and Expo stay on the host and do not need to appear in Ports — use **https://localhost:8443** for the app.

When run from an existing `turbopanel-dev` checkout, the script uses the checkout’s parent directory as the install root automatically (for example, if your checkout is at `~/turbopanel/dev`, sibling repos are created under `~/turbopanel/`). It does not prompt in that mode.

For piped or standalone runs (such as the one-liner above), the script may prompt for an install directory (default: `~/turbopanel`) when a terminal is available, or fall back to `~/turbopanel` when there is no controlling terminal.

In all cases, the script clones or updates the sibling repos under the chosen install root.

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
├── instance/ # turbopanel/turbopanel — core server (Workers + wrangler)
├── ui/       # turbopanel/turbopanel-ui — frontend
└── daemon/   # turbopanel/turbopanel-daemon — host daemon
```

## Branch conventions

All repositories use **`trunk`** as the default and integration branch. Do not use `main` or `master`.

## Updating

Re-running `src/develop/idempotent.sh` is safe. For each repo it will:

- **Skip** the repo if there are any uncommitted changes, printing a warning.
- **Pull** the latest `trunk` with `--ff-only` if the working tree is clean.

## Contributing

Create a feature branch off `trunk`, make your changes, then open a pull request back to `trunk`. Do not push directly to `trunk`.
