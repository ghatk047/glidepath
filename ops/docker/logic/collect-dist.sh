#!/bin/sh
# Collects the built entry files into one dist directory (part of the logic image build).
#
#   SERVER_ENTRY=... WORKER_ENTRY=... MIGRATE_ENTRY=... [STRICT_ENTRYPOINTS=1] \
#     collect-dist.sh <repo-root> <out-dir>
#
# Each *_ENTRY is the built file, relative to <repo-root>. Its whole directory is copied
# (chunks, source maps) and the entry is stored as <out-dir>/server.js, worker.js or
# migrate.js. A missing entry fails the build when STRICT_ENTRYPOINTS=1; otherwise it
# becomes a stub that says so and exits 78, so the image builds while a skeleton package
# has no entry yet.
set -eu

root=${1:?usage: collect-dist.sh <repo-root> <out-dir>}
out=${2:?usage: collect-dist.sh <repo-root> <out-dir>}
strict=${STRICT_ENTRYPOINTS:-0}
mkdir -p "$out"

collect() {
  name=$1
  rel=$2
  src="$root/$rel"
  if [ -f "$src" ]; then
    dir=$(dirname "$src")
    # Copy sibling outputs; refuse to overwrite a different file of the same name.
    (cd "$dir" && find . -type f) | while IFS= read -r f; do
      if [ -e "$out/$f" ] && ! cmp -s "$dir/$f" "$out/$f"; then
        echo "collect-dist: $f from $rel differs from a file already collected" >&2
        exit 1
      fi
      mkdir -p "$out/$(dirname "$f")"
      cp "$dir/$f" "$out/$f"
    done
    cp "$src" "$out/$name.js"
    echo "collect-dist: $name.js <- $rel"
  elif [ "$strict" = "1" ]; then
    echo "collect-dist: $rel not found and STRICT_ENTRYPOINTS=1" >&2
    exit 1
  else
    echo "collect-dist: $rel not found; dist/$name.js is a STUB" >&2
    cat > "$out/$name.js" <<STUB
// Stub written by ops/docker/logic/collect-dist.sh: $rel was not built into this image.
console.error('glidepath/logic: dist/$name.js is a stub (no build output at $rel). Rebuild once the entry exists.');
process.exit(78);
STUB
  fi
}

collect server "${SERVER_ENTRY:?SERVER_ENTRY is required}"
collect worker "${WORKER_ENTRY:?WORKER_ENTRY is required}"
collect migrate "${MIGRATE_ENTRY:?MIGRATE_ENTRY is required}"
