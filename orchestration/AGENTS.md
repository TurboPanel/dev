# Ansible Dev Overlay (`orchestration/`) — AGENTS.md

Repo context: `../AGENTS.md`.

## Ansible dev overlay

The **Ansible dev overlay** lives in `<dev checkout>/orchestration/` and overrides the daemon's production roles with dev-user parameters (the daemon still executes Ansible). Set `TURBOPANEL_MODE=development` during dev converge.

The **`dev-shell-path`** role (dev-only) always installs `/etc/profile.d/turbopanel-dev-deno.sh` (bash/login `sh`). When **zsh is installed** (`/usr/bin/zsh`), it also installs `/etc/zsh/zshenv.d/turbopanel-dev-deno` plus a guarded block in `/etc/zsh/zshenv` so **zsh invocations for the dest user** (including Oh My Zsh interactive shells — Debian does not source `/etc/zsh/zshrc.d`) prepend **`/opt/turbopanel/vendor/deno/current`** to `PATH`. Drop-ins are `root:<dev user>` mode `0640` (directory `0750`) so the dest login shell can source them without world-readable bits (`ansible:S2612`); Debian `/etc/profile` skips unreadable `profile.d` files. The role does not chmod Debian's `/etc/zsh/zshenv` conffile. Minimal Debian/Vagrant images ship bash only — zsh tasks are skipped rather than failing on a missing `/etc/zsh/zshenv` (do not create it on zsh-less hosts). That directory is the `deno-runtime` `current` symlink — version bumps only require updating the pin in the daemon role and `DENO_VERSION` in `scripts/lib/paths.sh` / `src/lib/paths.ts`, then re-converging. If a host later gains zsh, re-converge to wire the drop-ins.

### Development Caddyfile

Co-located hosts load **`orchestration/Caddyfile`** (not the managed
`instance-launch` template) when `turbopanel_dev_user` is set — wired by the
daemon `instance-launch` role via `turbopanel_caddyfile`. That file wins over
the rendered production Caddyfile, so a development host has no per-hostname
sites and refuses a Let's Encrypt hostname. That file owns:

- HTTPS `:8443` (always on; Platform CA). There is no plaintext control-plane listener.
- Expo reverse_proxy when `TURBOPANEL_UI_MODE=dev` (with `expo-loading.html` for cold-start 502s; `flush_interval -1` so Fast Refresh `/hot` is unbuffered). Host edits on VirtioFS/9p need Metro poll watch in the UI repo (`scripts/metro-virtfs-poll-watch.cjs`) — inotify does not cross the share.
- Optional wrangler upstream when `TURBOPANEL_INSTANCE_RUNTIME=workers`
- `/downloads/daemon/*` (always — overlay catalog + artifacts; not gated on `TURBOPANEL_UI_MODE`) and the install script at **`/run.sh`** from the daemon checkout (`dist/` after Developer → **Rebuild daemon and upgrade connected servers** / `deno task release:dev`)

- Stripping `CF-Connecting-IP` / `True-Client-IP` / `X-Forwarded-For` from non-loopback peers, so only a connector on this host can present them

The instance repo's `Caddyfile` stays production-only (HTTPS + Deno socket + static UI). See **`../turbopanel/AGENTS.md`** (Caddy) and **`../turbopaneld/src/instance/AGENTS.md`** (daemon TLS trust).

**Server addresses in development.** Vagrant forwards `8443` **over SSH**, so a daemon anywhere on the LAN reaches Caddy from `127.0.0.1` — the header-stripping matcher above never fires for it, and the peer address on the wire is `127.0.0.1` for every server. That is why the instance falls back to the interface addresses the daemon reports rather than trusting the wire (`src/lib/peer-address.ts` → `resolveServerAddress`, documented in **`../turbopanel/AGENTS.md`** → Caddy → Server addresses). A Cloudflare Tunnel pointed at this guest still resolves correctly: `cloudflared` is a loopback peer, so its `CF-Connecting-IP` is believed. Mixing LAN servers, tunnelled servers, and the co-located guest daemon in one fleet is the case this is built for.

### Ansible style (SonarQube)

- Prefer **`mode: "0640"`** / **`0750"`** over world-readable **`0644"`** / **`0755"`** for scripts and systemd units; set explicit **`owner`** / **`group`** (`ansible:S2612`).
