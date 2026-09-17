#!/bin/bash
# build + install into the local tinycast
set -euo pipefail
cd "$(dirname "$0")"
./build.sh
dest="$HOME/Library/Application Support/com.tinycast.app/extensions/symbolify"
mkdir -p "$dest"
cp extension/index.js extension/package.json "$dest/"
cp -R extension/assets "$dest/"
echo "deployed -> $dest"
