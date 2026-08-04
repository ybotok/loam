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

# Node >= 22.22.3 — hard requirement (package.json engines and LikeC4). Fail early with a fix
# hint instead of letting npm ci die on an engine warning three minutes in.
if ! command -v node >/dev/null 2>&1; then
  echo "error: node not found. Install Node.js >= 22.22.3 — e.g. via nvm (nvm install 22.22.3) or fnm (fnm install 22.22.3)." >&2
  exit 1
fi
if ! node -e '
  const have = process.versions.node.split(".").map(Number);
  const need = [22, 22, 3];
  const ok = have.some((part, index) => part > need[index] && have.slice(0, index).every((value, prior) => value === need[prior]))
    || have.every((part, index) => part === need[index]);
  process.exit(ok ? 0 : 1);
'; then
  echo "error: node $(node -v) is too old — loam needs >= 22.22.3." >&2
  echo "hint: nvm install 22.22.3 && nvm use 22.22.3   (or: fnm install 22.22.3 && fnm use 22.22.3)" >&2
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
