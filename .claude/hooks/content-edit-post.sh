#!/bin/bash
# Post-hook: git add + commit + push after content file edits
# Fires on PostToolUse:Edit and PostToolUse:Write

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
REL_PATH="${FILE_PATH#$REPO_ROOT/}"

# Only act on content/ and workspace/ files
if ! echo "$REL_PATH" | grep -qE '^(content|workspace)/'; then
  exit 0
fi

# Stage the edited file + index (may have been regenerated)
git add "$FILE_PATH" index/ 2>/dev/null

# Nothing staged → nothing to do
if git diff --cached --quiet 2>/dev/null; then
  exit 0
fi

# Commit and push
COMMIT_OUTPUT=$(git commit -m "content: edit ${REL_PATH}" 2>&1)
PUSH_OUTPUT=$(git push 2>&1)
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  jq -n --arg ctx "content sync: committed but push failed — $PUSH_OUTPUT" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
else
  NOTIFY_SUFFIX=""
  if echo "$REL_PATH" | grep -qE '^content/meetings/.+\.md$'; then
    FILE_STATUS=$(git diff HEAD~1 HEAD --name-status -- "$REL_PATH" 2>/dev/null | awk '{print $1}')
    if [ "$FILE_STATUS" = "A" ]; then
      set +e
      NOTIFY_OUT=$(node "$REPO_ROOT/scripts/hey.mjs" meeting notify "$REL_PATH" 2>&1)
      NOTIFY_EXIT=$?
      set -e
      if [ $NOTIFY_EXIT -eq 0 ]; then
        SENT=$(echo "$NOTIFY_OUT" | node -e "
          const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
          const r = (d.sent||[]).map(x=>x.recipient);
          process.stdout.write(r.length ? 'sent to '+r.join(', ') : 'no internal recipients');
        " 2>/dev/null || echo "sent")
        NOTIFY_SUFFIX=" | meeting-notify: $SENT"
      else
        NOTIFY_SUFFIX=" | meeting-notify: failed"
      fi
    fi
  fi
  jq -n --arg ctx "content sync: auto-committed and pushed (${REL_PATH})${NOTIFY_SUFFIX}" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $ctx
    }
  }'
fi
