#!/usr/bin/env bash
# Opens a nested GNOME Shell window with only Nocella enabled, for manual testing.
# It reuses the smoke-test sandbox: private dconf, extensions, and session bus, an
# ibus-daemon stub, and a memory-capped systemd scope. The real session's settings are
# never read or written. Close the window to end it.
#
# Usage: scripts/nested.sh [scale]
# Env:   MUTTER_DEBUG_DUMMY_MODE_SPECS   window size (default 1920x1080, 3840x2160 at scale 2)
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
NOCELLA_SANDBOX_NESTED=1 exec "$root/tests/smoke/run.sh" "${1:-1}"
