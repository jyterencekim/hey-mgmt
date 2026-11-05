#!/usr/bin/env bash
# Notify of open inbox items for the current member.
# Used by: Claude Code session hook, git post-merge hook.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MEMBER="${MEMBER:-}"
if [ -z "$MEMBER" ] && [ -f "$REPO_ROOT/.env" ]; then
  MEMBER="$(grep '^MEMBER=' "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2 || true)"
fi
[ -z "$MEMBER" ] && exit 0

INBOX_DIR="$REPO_ROOT/workspace/$MEMBER/inbox"
[ -d "$INBOX_DIR" ] || exit 0

# Inbox items live directly under the inbox dir (legacy) OR under
# status-named subdirectories (current). Either layout should be scanned.
shopt -s nullglob
candidates=("$INBOX_DIR"/*.json "$INBOX_DIR"/open/*.json)
shopt -u nullglob

# No candidates → nothing to report. (Guard against `set -u` + empty array
# expansion on bash 3.2 / macOS.)
[ "${#candidates[@]}" -eq 0 ] && exit 0

# Count open items
open_items=()
for f in "${candidates[@]}"; do
  [ -f "$f" ] || continue
  status=$(grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"/\1/' || true)
  [ "$status" = "open" ] || continue
  title=$(grep -o '"title"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"/\1/' || true)
  from=$(grep -o '"x_from"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"/\1/' || true)
  id=$(basename "$f" .json)
  open_items+=("  - ${from:+from $from: }$title ($id)")
done

count=${#open_items[@]}
[ "$count" -eq 0 ] && exit 0

echo "📬 $count open inbox item(s):"
for item in "${open_items[@]}"; do
  echo "$item"
done
echo "Run './hey inbox list --workspace $MEMBER' for details."
