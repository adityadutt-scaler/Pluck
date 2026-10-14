#!/usr/bin/env bash
# Move an agent-bridge capture out of Downloads into a project folder and print an
# outline of the TOON, so an agent can read it section by section instead of whole.
#
#   agent-import.sh <name> <dest-dir>
#
# The bridge saves to Downloads/pluck/<site>/<name>.*, one folder per site
# (e.g. localhost-3000). The newest capture of that name is taken unless
# PLUCK_SITE names the site.
#
# Environment:
#   PLUCK_DIR      Pluck's folder (default: ~/Downloads/pluck)
#   PLUCK_SITE     only take the capture from this site folder
#   PLUCK_REDACT   extra query parameter names to blank, '|'-separated
#                  (e.g. 'awssk|tenant_key'); the extension already blanks the
#                  common session / token parameters before saving.
set -euo pipefail

name="${1:?usage: agent-import.sh <name> <dest-dir>}"
dest="${2:?usage: agent-import.sh <name> <dest-dir>}"
# Saved under the name the extension writes ('Checkout Card' -> checkout-card).
name=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/\.{2,}/./g; s/^[-.]+//; s/[-.]+$//' | cut -c1-80)
root="${PLUCK_DIR:-$HOME/Downloads/pluck}"
mkdir -p "$dest"

# The site folder holding the newest <name>.toon or .html.
if [[ -n "${PLUCK_SITE:-}" ]]; then
  src="$root/$PLUCK_SITE"
else
  newest=$(ls -t "$root"/*/"$name".toon "$root"/*/"$name".html 2>/dev/null | head -1 || true)
  src="${newest%/*}"
fi
[[ -n "$src" && -d "$src" ]] || { echo "nothing to import: no $name.{toon,html} under $root/<site>/" >&2; exit 1; }

moved=0
for ext in toon html; do
  if [[ -f "$src/$name.$ext" ]]; then
    mv -f "$src/$name.$ext" "$dest/$name.$ext"
    moved=1
  fi
done
[[ $moved -eq 1 ]] || { echo "nothing to import: $src/$name.{toon,html} not found" >&2; exit 1; }

if [[ -n "${PLUCK_REDACT:-}" ]]; then
  for f in "$dest/$name.toon" "$dest/$name.html"; do
    [[ -f "$f" ]] || continue
    PLUCK_REDACT="$PLUCK_REDACT" perl -pi -e \
      'my $n = $ENV{PLUCK_REDACT}; s/([?&;#](?:amp;)?(?:$n)=)[^&#"\x27\s)<>]*/$1REDACTED/gi; s/((?:%3F|%26|%23)(?:$n)%3D)(?:(?!%26|%23)[^&#"\x27\s)<>])*/$1REDACTED/gi' "$f"
  done
fi

echo "imported -> $dest/"
ls -l "$dest/$name".* | awk '{print "  " $5 " bytes  " $NF}'
toon="$dest/$name.toon"
if [[ -f "$toon" ]]; then
  echo "outline (line: section) — read with an offset/limit, not the whole file:"
  grep -n '^## ' "$toon" | sed 's/^/  /'
  echo "  total lines: $(wc -l < "$toon" | tr -d ' ')"
fi
