# turbopanel-dev

## Project overview

TurboPanel is a self-hosted server management panel. This `dev` repository is the starting point for contributors — it bootstraps all sibling repositories and provides the tooling needed to run the full stack locally.

[develop.trbp.nl](https://develop.trbp.nl) is the canonical bootstrap URL. Local dev replicates the **Cloudflare Workers** deployment path: the instance runs via **`pnpm dev`** (`wrangler dev`) in `instance/`, the UI via Expo, and **Caddy** terminates TLS and routes traffic — same surface as production Workers, without Deno or systemd.

## Prerequisites

**You are responsible for installing these runtimes on your machine before running the bootstrap script.** The setup script checks that each tool is present and meets the minimum version, but it does not install them for you.

| Tool | Minimum version | Install |
|------|-----------------|---------|
| Node.js | 24.x | https://nodejs.org |
| pnpm | 11.x | `corepack enable` (uses each repo's `packageManager` field) or https://pnpm.io/installation |
| Docker | latest stable (daemon must be running) | https://docs.docker.com/get-docker/ |
| Tilt | latest stable | https://docs.tilt.dev/install.html |
| Deno | latest stable | https://docs.deno.com/runtime/getting_started/installation/ |
| openssl | any modern | macOS: `brew install openssl`; Debian/Ubuntu: `apt install openssl` |

## Getting started

**One-liner (fresh machine):**

```bash
curl -fsSL https://develop.trbp.nl | sh
```

**If you have already cloned this repo:**

```bash
sh pull.sh
```

When run from an existing `turbopanel-dev` checkout, the script uses the checkout’s parent directory as the install root automatically (for example, if your checkout is at `~/turbopanel/dev`, sibling repos are created under `~/turbopanel/`). It does not prompt in that mode.

For piped or standalone runs (such as the one-liner above), the script may prompt for an install directory (default: `~/turbopanel`) when a terminal is available, or fall back to `~/turbopanel` when there is no controlling terminal.

In all cases, the script clones or updates the sibling repos under the chosen install root.

After sibling repos are present, configure local dev env and start orchestration from the `dev/` checkout:

```bash
tilt up   # creates dev/.env from .env.example and fills missing secrets/defaults
```

When you exit with Ctrl+C, Tilt stops `serve_cmd` resources (instance, UI, website) but leaves Docker Compose containers (Postgres, Caddy) running. Tear everything down with:

```bash
tilt down
```

Tilt loads `dev/.env`, syncs derived files into sibling repos (`instance/.dev.vars`, `instance/.env`, `docker/.env`), then starts **Postgres**, the **Workers instance** (`pnpm dev` / wrangler), **Expo web**, the **daemon** (co-located agent), **Caddy** as the HTTPS entrypoint, and the **website** (Next.js marketing + docs).

| Service | URL |
|---------|-----|
| App (Caddy → UI + API) | https://localhost:8443 |
| API health | https://localhost:8443/api/health |
| Website (docs + API reference) | http://localhost:19820 |
| Website docs | http://localhost:19820/docs |
| Website API reference | http://localhost:19820/docs/api |
| Wrangler (direct, internal) | http://localhost:18787 |

The website port defaults to **19820** and is configurable via `WEBSITE_PORT` in `dev/.env` (Tilt passes it to the Next.js dev server and updates links accordingly).

Trust the generated platform CA at `instance/certs/ca.crt` in your browser to avoid TLS warnings (run `tilt up` once so `instance-certs` generates it).

Smoke test:

```bash
curl -k https://localhost:8443/api/health
curl -k https://localhost:8443/api/client/v1/install/status
```

## Repository layout

```
turbopanel/
├── dev/      # this repo — scripts, docs, shared dev tooling
├── instance/ # turbopanel/turbopanel — core server (Workers + wrangler)
├── ui/       # turbopanel/turbopanel-ui — frontend
├── daemon/   # turbopanel/turbopanel-daemon — host daemon
└── website/  # turbopanel/turbopanel-website — marketing + docs site (Tilt `website` resource, port 19820)
```

## Branch conventions

All repositories use **`trunk`** as the default and integration branch. Do not use `main` or `master`.

## Updating

Re-running `pull.sh` is safe. For each repo it will:

- **Skip** the repo if there are any uncommitted changes, printing a warning.
- **Pull** the latest `trunk` with `--ff-only` if the working tree is clean.

## Contributing

Create a feature branch off `trunk`, make your changes, then open a pull request back to `trunk`. Do not push directly to `trunk`.
