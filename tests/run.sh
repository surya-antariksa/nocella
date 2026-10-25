#!/usr/bin/env bash
# Runs the pure-logic unit tests with gjs. No GNOME Shell needed.
set -uo pipefail

cd "$(dirname "$0")/.."
status=0
for file in tests/*.test.js; do
    echo "# $file"
    gjs -m "$file" || status=1
done
exit "$status"
