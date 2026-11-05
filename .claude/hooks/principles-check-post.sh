#!/bin/bash
# Post-hook: run ./hey validate after content/workspace file edits.
# Fires on PostToolUse:Edit and PostToolUse:Write.
# Runs AFTER content-edit-post.sh (order determined by array position in settings.json).
#
# Principle (see playbook_golden-principles): principles apply at write time,
# not as an after-the-fact audit. This hook is the only mechanical gate.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
REL_PATH="${FILE_PATH#$REPO_ROOT/}"

if ! echo "$REL_PATH" | grep -qE '^(content|workspace)/'; then
  exit 0
fi

VALIDATE_OUTPUT=$(cd "$REPO_ROOT" && ./hey validate 2>&1)
VALIDATE_EXIT=$?

if [ $VALIDATE_EXIT -ne 0 ]; then
  TRIMMED=$(echo "$VALIDATE_OUTPUT" | head -60)
  jq -n --arg ctx "./hey validate found issues after editing ${REL_PATH}. Fix before moving on.

${TRIMMED}" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
else
  jq -n --arg ctx "./hey validate passed for ${REL_PATH}." '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
