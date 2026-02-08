#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tmanohar02/Projects/FamilyTree"
WORKTREE="/tmp/family-tree-gh-pages"
DEMO_DIR="$ROOT/family-chart/examples/local-csv-demo"

if [[ -z "${1-}" ]]; then
  echo "Usage: $0 <passphrase>"
  exit 1
fi
PASSPHRASE="$1"

node "$ROOT/scripts/csv-to-family-chart.mjs"
node "$ROOT/scripts/encrypt-family-data.mjs" "$PASSPHRASE"

# Prepare gh-pages worktree
if [[ -d "$WORKTREE" ]]; then
  git -C "$ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE"
fi

git -C "$ROOT" worktree add -B gh-pages "$WORKTREE" main
rm -rf "$WORKTREE"/*

cp "$DEMO_DIR/index.html" "$DEMO_DIR/data.enc.json" "$WORKTREE"/

git -C "$WORKTREE" add index.html data.enc.json
if git -C "$WORKTREE" diff --cached --quiet; then
  echo "No changes to publish."
else
  git -C "$WORKTREE" commit -m "Publish encrypted demo"
  git -C "$WORKTREE" push -u origin gh-pages
fi

git -C "$ROOT" worktree remove --force "$WORKTREE"
