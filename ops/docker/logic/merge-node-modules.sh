#!/bin/sh
# Merges the node_modules of several `pnpm deploy` outputs (hoisted layout: real directories)
# into one tree, so a single /app/node_modules serves server, worker and migrate.
#
#   merge-node-modules.sh <out-dir> <node_modules>...
#
# A package present in two inputs must have the same version; otherwise the build fails
# (two entries would need different copies of it, which one shared tree cannot give them).
# Dot entries (.pnpm, .bin, .modules.yaml) are pnpm bookkeeping and are not copied.
set -eu

out=${1:?usage: merge-node-modules.sh <out-dir> <node_modules>...}
shift
mkdir -p "$out"

version_of() { sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$1/package.json" | head -n 1; }

# merge_one <package-dir> <target-dir>
merge_one() {
  if [ -e "$2" ]; then
    if [ "$(version_of "$1")" != "$(version_of "$2")" ]; then
      echo "merge-node-modules: $(basename "$2") is $(version_of "$2") in one deploy and $(version_of "$1") in another" >&2
      exit 1
    fi
  else
    cp -R "$1" "$2"
  fi
}

for nm in "$@"; do
  for entry in "$nm"/*; do
    [ -e "$entry" ] || continue
    name=$(basename "$entry")
    case "$name" in
      @*)
        mkdir -p "$out/$name"
        for pkg in "$entry"/*; do
          [ -e "$pkg" ] || continue
          merge_one "$pkg" "$out/$name/$(basename "$pkg")"
        done
        ;;
      *)
        merge_one "$entry" "$out/$name"
        ;;
    esac
  done
done
