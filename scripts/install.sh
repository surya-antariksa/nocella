#!/usr/bin/env bash
# Packs the extension and installs it for the current user.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
zip="$("$root/scripts/pack.sh" | tail -n 1)"
gnome-extensions install --force "$zip"

cat <<'MSG'
Installed nocella@antariksa.
On Wayland, log out and back in so GNOME Shell picks up the new code, then run:
  gnome-extensions enable nocella@antariksa
MSG
