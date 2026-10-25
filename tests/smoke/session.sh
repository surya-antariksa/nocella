#!/usr/bin/env bash
# Runs inside the private session bus created by run.sh. Do not call directly.
# With NOCELLA_SANDBOX_NESTED=1 it opens a nested shell window for manual testing
# instead of running the headless driver.
set -uo pipefail

out="$1"
scale="$2"
work="$3"
here="$(cd "$(dirname "$0")" && pwd)"
nested="${NOCELLA_SANDBOX_NESTED:-}"

if [ -n "$nested" ]; then
    gsettings set org.gnome.shell enabled-extensions "['nocella@antariksa']"
else
    gsettings set org.gnome.shell enabled-extensions "['unsafe-mode@nocella.test', 'nocella@antariksa']"
fi
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
# Keeps the overview from waking Nautilus, Tracker, and other search providers.
gsettings set org.gnome.desktop.search-providers disable-external true
# The developer's real session is dark; the light theme gets its own checks (phase 7).
gsettings set org.gnome.desktop.interface color-scheme prefer-dark
size=1920x1080
if [ "$scale" = 2 ]; then
    gsettings set org.gnome.desktop.interface scaling-factor 2
    size=3840x2160
fi

log="$work/shell.log"
status=0

# Stops the shell this script started, and only that one. Gives it 5 s to exit on
# SIGTERM before forcing it, so the run can never hang here.
stop_shell() {
    kill "$shell_pid" 2>/dev/null || return 0
    for _ in $(seq 50); do
        kill -0 "$shell_pid" 2>/dev/null || break
        sleep 0.1
    done
    kill -KILL "$shell_pid" 2>/dev/null
    wait "$shell_pid" 2>/dev/null
}

if [ -n "$nested" ]; then
    # The nested shell is a client of the real compositor, so it needs the host socket.
    MUTTER_DEBUG_DUMMY_MODE_SPECS="${MUTTER_DEBUG_DUMMY_MODE_SPECS:-$size}" \
        WAYLAND_DISPLAY="$NOCELLA_HOST_WAYLAND_DISPLAY" \
        gnome-shell --nested --wayland --no-x11 --wayland-display nocella-nested 2>&1 | tee "$log"
    cp "$log" "$out/shell-nested.log"
else
    gnome-shell --headless --wayland --no-x11 --virtual-monitor "$size" \
        --wayland-display nocella-smoke >"$log" 2>&1 &
    shell_pid=$!
    trap stop_shell EXIT

    # NOCELLA_SMOKE_DRIVER runs another driver (e.g. a styling experiment) in the same sandbox.
    gjs -m "${NOCELLA_SMOKE_DRIVER:-$here/driver.js}" "$out" "$scale" || status=$?

    stop_shell
    trap - EXIT
    cp "$log" "$out/shell-x$scale.log"
fi

# A JS error is one line followed by its stack frames, so a match on the message line
# alone misses errors raised inside Nocella. Report a block when the message or any
# frame points at Nocella, plus Nocella's own tagged messages.
errors="$(awk '
    function flush() {
        if (block ~ /nocella@antariksa|\[nocella\]/)
            print block
        block = ""
    }
    /JS (ERROR|WARNING)|Gjs-CRITICAL|Gjs-WARNING/ { flush(); block = $0; next }
    block != "" && /@(file|resource):\/\// { block = block "\n" $0; next }
    { flush() }
    /nocella@antariksa|\[nocella\]/ && tolower($0) ~ /error|critical|warning|exception/ { print }
    END { flush() }
' "$log")"
if [ -n "$errors" ]; then
    echo "not ok - shell log has no nocella errors"
    echo "$errors" | sed 's/^/  /'
    status=1
else
    echo "ok - shell log has no nocella errors"
fi
exit "$status"
