#!/bin/sh
# Produces the SPA files for the web image in $1 (default /out).
#
# Run inside the Dockerfile's "spa" stage, from the repo root, after `pnpm install`.
# While tier1-presentation/web has no `build` script (skeleton, before WEB-01) the image
# serves ops/docker/web/placeholder/index.html. As soon as the package defines `build`
# (Vite, output in tier1-presentation/web/dist) the real app is built and served, with
# no change to this image definition. A build that produces no index.html fails loudly.
set -eu

out="${1:-/out}"
pkg="@glidepath/web"
dir="tier1-presentation/web"

mkdir -p "$out"

if [ -n "$(node -e "const s=require('./$dir/package.json').scripts||{};process.stdout.write(s.build||'')")" ]; then
  # Builds the web package and every workspace dependency (contract, ui) that has a build.
  pnpm --filter "$pkg..." --if-present run build
  if [ ! -f "$dir/dist/index.html" ]; then
    echo "build-spa: $pkg build did not produce $dir/dist/index.html" >&2
    exit 1
  fi
  cp -R "$dir/dist/." "$out/"
else
  echo "build-spa: $pkg has no build script yet; using the placeholder page" >&2
  cp ops/docker/web/placeholder/index.html "$out/index.html"
fi
