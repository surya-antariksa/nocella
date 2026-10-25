#!/usr/bin/env bash
# Regenerates extension/po/nocella.pot from the sources and merges it into every .po file.
set -euo pipefail

for tool in xgettext msgmerge; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found (apt install gettext)" >&2; exit 1; }
done

cd "$(dirname "$0")/../extension"
find . -name '*.js' -print | sort | xgettext \
    --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=N_ \
    --package-name=nocella --msgid-bugs-address=https://github.com/surya-antariksa/nocella/issues \
    --files-from=- --output=po/nocella.pot

for po in po/*.po; do
    msgmerge --update --backup=none "$po" po/nocella.pot
done
