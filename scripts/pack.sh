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

# Pack from a staging copy. getSettings() reads schemas/gschemas.compiled, and neither
# `gnome-extensions pack` nor `install` compiles it, so it is added to the zip below.
stage="$(mktemp -d "${TMPDIR:-/tmp}/nocella-pack.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
cp -r "$root/extension/." "$stage/"
glib-compile-schemas --strict "$stage/schemas"

# gnome-extensions compiles po/ with msgfmt from the gettext package, and uses po/
# whenever it exists. Without msgfmt, pack without po/ instead.
if command -v msgfmt >/dev/null; then
    args+=(--podir=po)
else
    echo "warning: msgfmt not found, packing without translations (apt install gettext)" >&2
    rm -rf "$stage/po"
fi

gnome-extensions pack "${args[@]}" "$stage"
zip_path="$out/nocella@antariksa.shell-extension.zip"
python3 -I - "$zip_path" "$stage/schemas/gschemas.compiled" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1], 'a', zipfile.ZIP_DEFLATED) as bundle:
    bundle.write(sys.argv[2], 'schemas/gschemas.compiled')
PY
echo "$zip_path"
