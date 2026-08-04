#!/usr/bin/env bash
# One-shot setup on any machine: check node, install, build, smoke-test.
#
#   scripts/setup.sh          # install + build + smoke
#   scripts/setup.sh --link   # ...and npm link a global `loam` on top
#
# Windows (no bash): the steps are the same by hand —
#   npm ci && npm run build
# then `node dist/cli.js --help` to smoke-test, `npm link` if you want it global.
set -euo pipefail

cd "$(dirname "$0")/.."

# Node >= 20 — hard requirement (package.json engines). Fail early with a fix
# hint instead of letting npm ci die on an engine warning three minutes in.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js >= 20 — e.g. via nvm (nvm install 20) or fnm (fnm install 20)." >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 20 ]; then
  echo "error: node $(node -v) is too old — loam needs >= 20." >&2
  echo "hint: nvm install 20 && nvm use 20   (or: fnm install 20 && fnm use 20)" >&2
  exit 1
fi

npm ci
npm run build

# Smoke: the built CLI must at least print its own help, or the build is a lie.
node dist/cli.js --help >/dev/null
echo "ok: node dist/cli.js --help works"

if [ "${1:-}" = "--link" ]; then
  npm link
  echo "ok: linked — \`loam\` is now on your PATH"
else
  echo "next: npm link — if you want a global \`loam\`; npm run dev -- <cmd> — to run from sources"
fi
