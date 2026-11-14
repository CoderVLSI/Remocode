#!/usr/bin/env bash
# Makes a small, backend-only copy of the project, so you can deploy the Convex backend (and run the
# self-test) on a machine that does not need the whole React Native toolchain, such as Termux on a phone.
#
#   ./scripts/backend-only.sh [target-dir]        (default: ../remocode-backend)
#
# Only `convex/`, `companion/` and the two Convex scripts are copied, with a minimal package.json,
# so `npm install` fetches a few packages instead of the whole Expo tree.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$SRC/../remocode-backend}"

mkdir -p "$DEST/scripts"
rm -rf "$DEST/convex" "$DEST/companion"
cp -R "$SRC/convex" "$DEST/convex"
# the companion's own node_modules is machine-specific; it installs its own
mkdir -p "$DEST/companion"
(cd "$SRC/companion" && cp -R index.mjs package.json src test "$DEST/companion/")
cp "$SRC/scripts/convex-setup.mjs" "$SRC/scripts/convex-selftest.mjs" "$DEST/scripts/"

node -e '
const root = require(process.argv[1] + "/package.json");
const pick = (names) => Object.fromEntries(names.map((n) => [n, root.dependencies?.[n] ?? root.devDependencies?.[n]]).filter(([, v]) => v));
const pkg = {
  name: "remocode-backend",
  private: true,
  type: "module",
  scripts: {
    "convex:setup": "node scripts/convex-setup.mjs",
    selftest: "node scripts/convex-selftest.mjs",
  },
  dependencies: pick(["convex", "@convex-dev/auth", "@auth/core"]),
  devDependencies: pick(["typescript", "@types/node"]),
};
pkg.dependencies.jose = "^" + require(process.argv[1] + "/node_modules/jose/package.json").version;
require("fs").writeFileSync(process.argv[2] + "/package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$SRC" "$DEST"

echo "Backend-only copy created in: $DEST"
echo "Next:"
echo "  cd \"$DEST\" && npm install && (cd companion && npm install)"
echo "  npx convex login --no-open      # then open the link it prints in any browser"
echo "  npx convex dev                  # deploy; prints your .convex.cloud URL"
