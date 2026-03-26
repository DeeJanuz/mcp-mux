#!/bin/bash
# Build the SSE bridge sidecar to a single bundled .mjs file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p dist

npx esbuild sse-bridge.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=esm \
  --outfile=dist/sse-bridge.mjs

echo "Built sidecar: dist/sse-bridge.mjs"
