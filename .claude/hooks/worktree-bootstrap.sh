#!/usr/bin/env bash
# SessionStart hook: in a git worktree, symlink gitignored files from the main
# checkout so the session-start workflow can read them (`.env` → MEMBER, etc.).
# In the main checkout this is a no-op.
set -eo pipefail

WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$WORKTREE_ROOT" ] && exit 0

# In a worktree, .git is a file ("gitdir: …/.git/worktrees/<name>").
# In the main checkout, .git is a directory.
[ ! -f "$WORKTREE_ROOT/.git" ] && exit 0

GITDIR_LINE="$(cat "$WORKTREE_ROOT/.git")"
MAIN_GIT_DIR="${GITDIR_LINE#gitdir: }"
MAIN_GIT_DIR="${MAIN_GIT_DIR%/worktrees/*}"
[ -d "$MAIN_GIT_DIR" ] || exit 0
MAIN_ROOT="$(dirname "$MAIN_GIT_DIR")"
[ "$MAIN_ROOT" = "$WORKTREE_ROOT" ] && exit 0

linked=""
# Items that are gitignored and required by the session-start workflow / hooks.
for item in .env; do
  src="$MAIN_ROOT/$item"
  dst="$WORKTREE_ROOT/$item"
  [ -e "$src" ] || continue
  if [ ! -e "$dst" ] && [ ! -L "$dst" ]; then
    ln -s "$src" "$dst"
    linked="$linked $item"
  fi
done

if [ -n "$linked" ]; then
  jq -n --arg ctx "worktree-bootstrap: linked${linked} from $MAIN_ROOT" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
fi
exit 0
