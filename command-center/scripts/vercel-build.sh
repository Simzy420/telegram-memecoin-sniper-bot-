#!/bin/sh
# Vercel sometimes runs this command with cwd set to api/.
# npm still builds the repo root, then the output check looks in the
# original cwd. Build at the package root and mirror the result back.
set -eu
START=$(pwd)
ROOT=$(npm prefix)
echo "CC_START=$START"
echo "CC_ROOT=$ROOT"
cd "$ROOT"
npm run build
# Node traces api/ before the static build. package.json "vercel-build"
# emits the JS module that import resolves, and this repeats it here so the
# file exists even if only the project build command runs.
npm run vercel-build
node scripts/attach-drive-function.mjs
if [ "$START" != "$ROOT" ]; then
  mkdir -p "$START/dist"
  cp -R "$ROOT/dist/." "$START/dist/"
  if [ -d "$ROOT/.vercel/output" ]; then
    mkdir -p "$START/.vercel"
    rm -rf "$START/.vercel/output"
    cp -R "$ROOT/.vercel/output" "$START/.vercel/output"
  fi
fi
