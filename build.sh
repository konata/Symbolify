#!/bin/bash
# build: zero npm deps, everything externalized, no install step
set -euo pipefail
cd "$(dirname "$0")/extension"
NODE_ENV=production bun build src/index.tsx --target=node --format=cjs \
  --external "@raycast/api" --external "react" --external "react/jsx-runtime" \
  --outfile=index.js
# bun output may reference jsx-dev-runtime; the tinycast shim only provides jsx-runtime, rewrite mechanically
perl -pi -e 's/require\("react\/jsx-dev-runtime"\)/require("react\/jsx-runtime")/g; s/\.jsxDEV\(/.jsx(/g' index.js
grep -q "jsx-dev-runtime" index.js && { echo "ERROR: jsx-dev-runtime survived"; exit 1; }
node --check index.js && echo "built extension/index.js ($(du -h index.js | cut -f1))"
