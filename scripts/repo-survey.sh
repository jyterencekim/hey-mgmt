#!/usr/bin/env bash
# Survey git activity across working repos for a given member.
# Usage: ./scripts/repo-survey.sh [member] [--since TIME]
#
# Reads workspace/$MEMBER/repos.yml for local repo paths.
# Outputs a structured digest: branch, today's commits, uncommitted changes.

set -euo pipefail

MEMBER="${1:-${MEMBER:-}}"
SINCE="midnight"

if [[ -z "$MEMBER" ]]; then
  if [[ -f .env ]]; then
    MEMBER=$(grep '^MEMBER=' .env | cut -d= -f2 | tr -d ' ')
  fi
fi

if [[ -z "$MEMBER" ]]; then
  echo "Usage: $0 <member> [--since TIME]" >&2
  exit 1
fi

if [[ "${2:-}" == "--since" ]]; then
  SINCE="${3:-midnight}"
fi

REPOS_FILE="workspace/${MEMBER}/repos.yml"

if [[ ! -f "$REPOS_FILE" ]]; then
  echo "No repos file at $REPOS_FILE — skipping repo survey." >&2
  echo "Copy scripts/repos.example.yml to $REPOS_FILE and replace the paths with your local clones." >&2
  exit 0
fi

# Parse repo paths from YAML (simple grep, no yq dependency)
grep '^\s*path:' "$REPOS_FILE" | sed 's/.*path:\s*//' | while read -r repo_path; do
  repo_path=$(echo "$repo_path" | xargs)  # trim whitespace
  repo_path="${repo_path/#\~/$HOME}"      # expand leading ~ to $HOME
  if [[ ! -d "$repo_path/.git" ]]; then
    continue
  fi

  repo_name=$(basename "$repo_path")
  branch=$(git -C "$repo_path" branch --show-current 2>/dev/null || echo "detached")
  commits=$(git -C "$repo_path" log --format="%h %ai | %s" --since="$SINCE" 2>/dev/null || true)
  if [[ -n "$commits" ]]; then
    commit_count=$(echo "$commits" | wc -l | tr -d ' ')
  else
    commit_count=0
  fi
  dirty=$(git -C "$repo_path" diff --stat -- ':!.omc' 2>/dev/null || true)
  staged=$(git -C "$repo_path" diff --cached --stat -- ':!.omc' 2>/dev/null || true)

  # Skip repos with zero activity
  if [[ "$commit_count" -eq 0 && -z "$dirty" && -z "$staged" ]]; then
    continue
  fi

  echo "=== $repo_name ($branch) ==="

  if [[ "$commit_count" -gt 0 ]]; then
    echo "Commits since $SINCE ($commit_count):"
    echo "$commits" | sed 's/^/  /'
  fi

  if [[ -n "$staged" ]]; then
    echo "Staged:"
    echo "$staged" | sed 's/^/  /'
  fi

  if [[ -n "$dirty" ]]; then
    echo "Uncommitted:"
    echo "$dirty" | sed 's/^/  /'
  fi

  echo ""
done
