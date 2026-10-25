#!/usr/bin/env bash
# Builds build/nocella@antariksa.shell-extension.zip from extension/.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/build"
mkdir -p "$out"

args=(
    --force
    --out-dir="$out"
    --extra-source=src
    --schema=schemas/org.gnome.shell.extensions.nocella.gschema.xml
)

source="$root/extension"

# gnome-extensions compiles po/ with msgfmt from the gettext package, and uses po/
# whenever it exists. Without msgfmt, pack a copy that has no po/ instead.
if command -v msgfmt >/dev/null; then
    args+=(--podir=po)
else
    echo "warning: msgfmt not found, packing without translations (apt install gettext)" >&2
    stage="$(mktemp -d "${TMPDIR:-/tmp}/nocella-pack.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    cp -r "$root/extension/." "$stage/"
    rm -rf "$stage/po"
    source="$stage"
fi

gnome-extensions pack "${args[@]}" "$source"
echo "$out/nocella@antariksa.shell-extension.zip"
