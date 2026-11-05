#!/bin/bash
# Pre-hook: git pull --rebase before ANY hey invocation.
# Covers all CRUD (create/read/update/delete) so writes propagate and reads see fresh state.
# Fires on PreToolUse:Bash — exits 0 (allow) for non-hey commands.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Act on any hey invocation: ./hey or hey.mjs (path form or script form)
if ! echo "$COMMAND" | grep -qE '(^|[[:space:]]|[;&|(])(\./hey|[^[:space:]]*hey\.mjs)([[:space:]]|$)'; then
  exit 0
fi

# Pull and rebase
OUTPUT=$(git pull --rebase --autostash 2>&1)
EXIT_CODE=$?

# Record what is already dirty so the post-hook commits only what this hey call changes.
. "$(dirname "$0")/git-sync-snapshot.sh"
SNAP_FILE=$(git_sync_snapshot_file "$(echo "$INPUT" | jq -r '.tool_use_id // ""')") && git_sync_snapshot > "$SNAP_FILE"

if [ $EXIT_CODE -ne 0 ]; then
  # Check if it's a rebase conflict
  if echo "$OUTPUT" | grep -qi 'conflict\|merge\|rebase'; then
    jq -n --arg reason "git pull --rebase failed with conflicts. Resolve before running hey: $OUTPUT" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  else
    # Non-conflict failure (offline, no remote, etc.) — allow anyway
    jq -n --arg ctx "git pull --rebase failed (non-fatal): $OUTPUT" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: $ctx
      }
    }'
  fi
else
  if echo "$OUTPUT" | grep -qi 'already up to date'; then
    exit 0
  fi
  jq -n --arg ctx "git pull --rebase: $OUTPUT" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $ctx
    }
  }'
fi
