#!/usr/bin/env bash
#
# Build @postman-clone/contracts and install it into each app's node_modules
# as a real directory.
#
# Why a copy instead of yarn workspaces / npm link: both of those are
# symlink-based, and this project lives on a volume where NTFS reparse points
# fail (`ERROR_FILE_CORRUPT` on every junction/symlink, drive-wide). A copied
# build is byte-for-byte what a published dependency looks like to Node, tsc
# and Vite, so imports stay `@postman-clone/contracts` and nothing in the
# application code changes if this ever moves to real workspaces.
#
# Run this after any `yarn install` — yarn prunes packages it does not know
# about — and after editing anything under packages/contracts/src.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT/packages/contracts"
PKG_NAME="@postman-clone/contracts"
CONSUMERS=(backend frontend)

# Check for the binary, not the directory: a half-populated node_modules from
# an interrupted install would otherwise be mistaken for a good one.
if [ ! -x "$PKG_DIR/node_modules/.bin/tsc" ]; then
  echo "==> installing contracts toolchain"
  ( cd "$PKG_DIR" && yarn install --silent )
fi

echo "==> building $PKG_NAME"
( cd "$PKG_DIR" && yarn --silent build )

[ -f "$PKG_DIR/dist/index.js" ] || {
  echo "[error] contracts build produced no dist/index.js" >&2
  exit 1
}

for app in "${CONSUMERS[@]}"; do
  dest="$ROOT/$app/node_modules/$PKG_NAME"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "$PKG_DIR/package.json" "$dest/package.json"
  cp -R "$PKG_DIR/dist" "$dest/dist"
  echo "    installed into $app/node_modules/$PKG_NAME"
done
