#!/bin/bash
# Post-hook: git add + commit + push after ANY hey invocation that changed tracked files.
# Read-only hey calls stage nothing and exit silently.
# Fires on PostToolUse:Bash — exits 0 for non-hey commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Act on any hey invocation: ./hey or hey.mjs (path form or script form)
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]]|[;&|(])(\./hey|[^[:space:]]*hey\.mjs)([[:space:]]|$)'; then
  exit 0
fi

# Commit-message label: the FIRST hey invocation's subcommand (≤2 non-flag tokens),
# taken from the command collapsed to ONE line. The previous sed|awk ran per line, so a
# multi-line command (heredoc, python - <<EOF, …) emitted every line's first two words
# and the whole heredoc became the commit message (2026-09-02, three times in one day).
ONELINE=$(printf '%s' "$COMMAND" | tr '\n\r' '  ')
LABEL=$(printf '%s' "$ONELINE" \
  | grep -oE '(^|[[:space:]]|[;&|(])(\./hey|[^[:space:]]*hey\.mjs)[[:space:]]+[^-[:space:];&|<>]+([[:space:]]+[^-[:space:];&|<>]+)?' \
  | head -1 \
  | sed -E 's@^.*(\./hey|hey\.mjs)[[:space:]]+@@' \
  | cut -c1-60)
[ -z "$LABEL" ] && LABEL="invoke"

# Stage only paths this hey call changed: new dirty paths and dirty paths whose content changed
# since the pre-hook snapshot. Files other sessions left dirty in the shared checkout stay unstaged.
. "$(dirname "$0")/git-sync-snapshot.sh"
SNAP_FILE=$(git_sync_snapshot_file "$(echo "$INPUT" | jq -r '.tool_use_id // ""')")
if [ -z "$SNAP_FILE" ] || [ ! -f "$SNAP_FILE" ]; then
  jq -n --arg ctx "git sync post: no pre-hook snapshot; nothing auto-committed. Commit this hey call's files explicitly." '{
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $ctx }
  }'
  exit 0
fi
PATHS_FILE="${SNAP_FILE}.paths"
git_sync_snapshot | comm -13 "$SNAP_FILE" - | cut -f2- | sed '/^$/d' > "$PATHS_FILE"
rm -f "$SNAP_FILE"

# Nothing changed → read-only invocation, done
if [ ! -s "$PATHS_FILE" ]; then
  rm -f "$PATHS_FILE"
  exit 0
fi

# Commit only these paths, so anything another session staged stays out of this commit too.
git add -A --pathspec-from-file="$PATHS_FILE" 2>/dev/null
STAGED=$(head -20 "$PATHS_FILE")
COMMIT_OUTPUT=$(git commit -q -m "hey: ${LABEL}" -m "${STAGED}" --pathspec-from-file="$PATHS_FILE" 2>&1)
rm -f "$PATHS_FILE"
PUSH_OUTPUT=$(git push 2>&1)
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  jq -n --arg ctx "git sync post: committed but push failed — $PUSH_OUTPUT" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
else
  jq -n --arg ctx "git sync: auto-committed and pushed (hey: ${LABEL})" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
