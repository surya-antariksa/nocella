#!/usr/bin/env bash
# Runs the phase 1 smoke test in an isolated headless GNOME Shell. Nothing touches the
# real session: dconf, extensions, caches, runtime dir, session bus, and Wayland socket
# are all private to a temporary directory. scripts/nested.sh reuses the same sandbox
# for a nested shell window (NOCELLA_SANDBOX_NESTED=1).
#
# The whole run lives in a systemd scope with a hard memory limit and no swap, so a
# runaway shell or service cannot exhaust the machine. Memory use is sampled every
# second, and any process still alive after the test is reported and stopped.
#
# Usage: tests/smoke/run.sh [scale]    scale is 1 (default) or 2
# Env:   NOCELLA_SMOKE_MEMORY_MAX      scope memory limit (default 1536M)
#        NOCELLA_SMOKE_DRIVER          another gjs driver to run in the same sandbox
# Output: build/smoke/ (screenshots, shell log, memory log)
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
scale="${1:-1}"
out="$root/build/smoke"

if [ -z "${NOCELLA_SMOKE_SCOPE:-}" ]; then
    available_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
    if [ "$available_kb" -lt $((3 * 1024 * 1024)) ]; then
        echo "error: less than 3 GiB of RAM available, not starting a second GNOME Shell" >&2
        exit 1
    fi

    unit="nocella-smoke-$$"
    # Safety net, also on Ctrl-C: stop anything that still lives in the scope.
    trap 'systemctl --user stop "$unit.scope" 2>/dev/null || true' EXIT
    trap 'exit 130' INT TERM
    status=0
    NOCELLA_SMOKE_SCOPE="$unit" systemd-run --user --scope --quiet --collect \
        --unit="$unit" -p MemoryMax="${NOCELLA_SMOKE_MEMORY_MAX:-1536M}" -p MemorySwapMax=0 \
        "$0" "$scale" || status=$?
    exit "$status"
fi

# From here on we run inside the scope.
cgroup="/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup | head -n 1)"
if [ "$(cat "$cgroup/memory.max" 2>/dev/null || echo max)" = max ]; then
    echo "error: the memory limit is not active (is the cgroup memory controller delegated?)" >&2
    exit 1
fi
tag="x$scale"
[ -z "${NOCELLA_SANDBOX_NESTED:-}" ] || tag=nested
work="$(mktemp -d "${TMPDIR:-/tmp}/nocella-smoke.XXXXXX")"
# Wayland socket paths are limited to 108 bytes, so the runtime dir needs a short path.
runtime="$(mktemp -d "${XDG_RUNTIME_DIR:-/tmp}/nocella-smoke.XXXXXX")"
memory_log="$out/memory-$tag.log"
mkdir -p "$out"

cleanup() {
    # The document portal may still have its FUSE mount in the runtime dir.
    fusermount3 -uz "$runtime/doc" 2>/dev/null || fusermount -uz "$runtime/doc" 2>/dev/null || true
    rm -rf "$work" "$runtime"
    # Services activated on the private bus (gvfsd-metadata) may flush once more on exit.
    sleep 1
    rm -rf "$work" "$runtime"
}
trap cleanup EXIT

# Prints the processes of this scope, largest first, as "rss_kib pid command".
scope_processes() {
    local pids
    mapfile -t pids < "$cgroup/cgroup.procs"
    [ "${#pids[@]}" -gt 0 ] || return 0
    ps -o rss=,pid=,comm= -p "$(IFS=,; echo "${pids[*]}")" --sort=-rss 2>/dev/null || true
}

sample_memory() {
    while true; do
        echo "--- $(date +%T) $(( $(cat "$cgroup/memory.current") / 1048576 )) MiB"
        scope_processes | head -n 8
        sleep 1
    done
}

zip="$("$root/scripts/pack.sh" | tail -n 1)"

if [ -n "${NOCELLA_SANDBOX_NESTED:-}" ]; then
    # Absolute path to the real compositor's socket, before XDG_RUNTIME_DIR changes.
    case "${WAYLAND_DISPLAY:?a nested shell needs a Wayland session}" in
        /*) export NOCELLA_HOST_WAYLAND_DISPLAY="$WAYLAND_DISPLAY" ;;
        *) export NOCELLA_HOST_WAYLAND_DISPLAY="$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ;;
    esac
fi

export XDG_DATA_HOME="$work/data"
export XDG_CONFIG_HOME="$work/config"
export XDG_CACHE_HOME="$work/cache"
export XDG_STATE_HOME="$work/state"
export XDG_RUNTIME_DIR="$runtime"
chmod 700 "$XDG_RUNTIME_DIR"
unset WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS

extensions="$XDG_DATA_HOME/gnome-shell/extensions"
mkdir -p "$extensions/nocella@antariksa"
unzip -q "$zip" -d "$extensions/nocella@antariksa"
cp -r "$root/tests/smoke/unsafe-mode@nocella.test" "$extensions/"

# Without the systemd user instance on its bus, GNOME Shell starts its own ibus-daemon.
# Those daemons outlived earlier runs and kept growing until the machine ran out of
# memory (2026-10-24), so the test session gets a no-op stub instead.
mkdir -p "$work/bin"
printf '#!/bin/sh\nexit 0\n' > "$work/bin/ibus-daemon"
chmod +x "$work/bin/ibus-daemon"
export PATH="$work/bin:$PATH"

# A private bus that can activate dconf and nothing else, so Tracker, Evolution,
# Nautilus, and the portals stay off.
mkdir -p "$work/dbus-services"
cp /usr/share/dbus-1/services/ca.desrt.dconf.service "$work/dbus-services/"
cat > "$work/session-bus.conf" <<CONF
<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"
 "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>session</type>
  <keep_umask/>
  <listen>unix:dir=$runtime</listen>
  <auth>EXTERNAL</auth>
  <servicedir>$work/dbus-services</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
CONF

sample_memory > "$memory_log" &
sampler_pid=$!

status=0
dbus-run-session --config-file="$work/session-bus.conf" -- "$root/tests/smoke/session.sh" "$out" "$scale" "$work" || status=$?

sleep 2
kill "$sampler_pid" 2>/dev/null || true
wait "$sampler_pid" 2>/dev/null || true
# Let the sampler's last `sleep` finish.
sleep 1

# Anything other than this script still alive now was left behind by the session. The
# list goes through a file so no subshell of ours shows up in it.
scope_processes > "$work/leftovers"
leftovers="$(awk -v self="$$" '$2 != self && $3 != "ps"' "$work/leftovers")"
if [ -n "$leftovers" ]; then
    echo "not ok - no processes outlive the session"
    echo "$leftovers" | sed 's/^/  leftover (rss KiB, pid, command): /'
    echo "$leftovers" | awk '{print $2}' | xargs -r kill 2>/dev/null || true
    status=1
else
    echo "ok - no processes outlive the session"
fi

peak="$(cat "$cgroup/memory.peak" 2>/dev/null || echo 0)"
echo "# peak memory of the test scope: $(( peak / 1048576 )) MiB"
echo "# OOM kills inside the scope: $(awk '/^oom_kill / {print $2}' "$cgroup/memory.events" 2>/dev/null)"
echo "# busiest sample (MiB, then top processes by RSS KiB):"
awk '/^---/ {if (block && mib > best) {best = mib; top = block} block = $0 "\n"; mib = $3; next}
     {block = block $0 "\n"}
     END {if (mib > best) top = block; printf "%s", top}' "$memory_log" | sed 's/^/#   /'
exit "$status"
