#!/bin/sh
# Printed by https://dev.turbopanel.sh (assets-only Workers host).
# Does not install anything — contributor setup is Vagrant + sibling checkouts.
#
# Docs: https://turbopanel.io/docs/getting-started/development

set -eu

cat <<'EOF'
TurboPanel contributor setup (Vagrant)

The old curl|sh bootstrap is retired. Development runs inside a Vagrant guest
with your six sibling repos mounted from the host.

1. Clone (or fork) these repos side by side — keep your own remotes/branches
   for pull requests:

     turbopanel/
     ├── dev/          # https://github.com/turbopanel/dev  (has Vagrantfile)
     ├── turbopaneld/  # https://github.com/turbopanel/turbopaneld
     ├── turbopanel/   # https://github.com/turbopanel/turbopanel
     ├── ui/           # https://github.com/turbopanel/ui
     ├── website/      # https://github.com/turbopanel/website
     └── .github/      # https://github.com/turbopanel/.github

2. Install Vagrant plus a provider:
   - Linux: QEMU/KVM + libvirt + vagrant-libvirt (Debian 13 guest)
   - macOS: UTM + vagrant_utm plugin (Debian 12 guest until Trixie UTM exists)

3. From the dev checkout:

     cd turbopanel/dev
     vagrant up
     vagrant ssh

4. Inside the guest, start the Ink console (installs runtimes + converges):

     cd ~/dev && ./console

5. On the host, open the control plane (ports are forwarded):

     https://localhost:8443
     http://localhost:8880

   Prefer a LAN hostname for your host when attaching remote test machines
   (e.g. https://dev.lan:8443) — 8443/8880/8088/19820 bind on 0.0.0.0.

Full guide: https://turbopanel.io/docs/getting-started/development
EOF

exit 0
