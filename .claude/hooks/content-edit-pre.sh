#!/bin/bash
# Pre-hook: git pull --rebase before content file edits
# Fires on PreToolUse:Edit and PreToolUse:Write

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
REL_PATH="${FILE_PATH#$REPO_ROOT/}"

# Only act on content/ and workspace/ files
if ! echo "$REL_PATH" | grep -qE '^(content|workspace)/'; then
  exit 0
fi

# Pull and rebase
OUTPUT=$(git pull --rebase --autostash 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  if echo "$OUTPUT" | grep -qi 'conflict\|merge\|rebase'; then
    jq -n --arg reason "git pull --rebase failed with conflicts. Resolve before editing content: $OUTPUT" '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      }
    }'
  else
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
