#!/bin/bash
# Shared by git-sync-pre.sh / git-sync-post.sh. Prints one "<blob-sha-or-DELETED>\t<path>" line per
# path under content/, workspace/ and index/ that differs from HEAD (tracked) or is untracked.
# Several agent sessions share one checkout, so the post-hook stages only paths whose line changed
# across the hey invocation; files other sessions left dirty are not swept into the commit.

git_sync_snapshot() {
  { git diff --name-only HEAD -- content workspace index 2>/dev/null
    git ls-files -o --exclude-standard -- content workspace index 2>/dev/null
  } | sort -u | while IFS= read -r path; do
    [ -z "$path" ] && continue
    if [ -e "$path" ]; then
      printf '%s\t%s\n' "$(git hash-object -- "$path" 2>/dev/null)" "$path"
    else
      printf 'DELETED\t%s\n' "$path"
    fi
  done | sort
}

git_sync_snapshot_file() {
  # One file per tool call; tool_use_id pairs the PreToolUse and PostToolUse events.
  local id
  id=$(printf '%s' "$1" | tr -cd 'A-Za-z0-9_-')
  [ -z "$id" ] && return 1
  printf '%s/hey-git-sync-%s.snapshot\n' "${TMPDIR:-/tmp}" "$id"
}
