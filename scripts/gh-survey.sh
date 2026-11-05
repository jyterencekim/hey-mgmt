#!/usr/bin/env bash
# Survey GitHub activity across repos listed in content/vocab/repos.yml.
# Usage: ./scripts/gh-survey.sh [member] [--team] [--since DAYS]
#
# For human members: shows their own authored PRs and assigned issues.
# For --team or member=fisher: shows all activity across repos.
# Reads repo registry from content/vocab/repos.yml (remote URLs).
# Outputs a structured digest matching repo-survey.sh convention.

set -eo pipefail

MEMBER=""
TEAM_MODE=false
SINCE_DAYS=7

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --team) TEAM_MODE=true; shift ;;
    --since) SINCE_DAYS="${2:-7}"; shift 2 ;;
    *) if [[ -z "$MEMBER" ]]; then MEMBER="$1"; fi; shift ;;
  esac
done

# Fallback to .env
if [[ -z "$MEMBER" ]]; then
  if [[ -f .env ]]; then
    MEMBER=$(grep '^MEMBER=' .env | cut -d= -f2 | tr -d ' ' || true)
  fi
fi

if [[ -z "$MEMBER" ]] && [[ "$TEAM_MODE" == "false" ]]; then
  echo "Usage: $0 <member> [--team] [--since DAYS]" >&2
  exit 1
fi

# Fisher is always team-level
if [[ "$MEMBER" == "fisher" ]]; then
  TEAM_MODE=true
fi

REPOS_FILE="content/vocab/repos.yml"

if [[ ! -f "$REPOS_FILE" ]]; then
  echo "No repos file at $REPOS_FILE — skipping GitHub survey." >&2
  exit 0
fi

# Check gh CLI availability
if ! command -v gh &>/dev/null; then
  echo "gh CLI not installed — skipping GitHub survey. Install: https://cli.github.com" >&2
  exit 0
fi

# Check gh auth status (suppress output, just check exit code)
if ! gh auth status &>/dev/null; then
  echo "gh CLI not authenticated — skipping GitHub survey. Run: gh auth login" >&2
  exit 0
fi

SINCE_DATE=$(date -v-${SINCE_DAYS}d +%Y-%m-%d 2>/dev/null || date -d "${SINCE_DAYS} days ago" +%Y-%m-%d 2>/dev/null || echo "")
if [[ -z "$SINCE_DATE" ]]; then
  SINCE_DATE=$(python3 -c "from datetime import datetime, timedelta; print((datetime.now() - timedelta(days=${SINCE_DAYS})).strftime('%Y-%m-%d'))" 2>/dev/null || echo "2026-03-25")
fi

# Map member names to GitHub usernames
gh_user_for_member() {
  case "$1" in
    charlie) echo "charlie-dev" ;;
    alice)   echo "alice-dev" ;;
    bob)  echo "bob-dev" ;;
    dana)      echo "dana-dev" ;;
    *)       echo "$1" ;;
  esac
}

GH_USER=$(gh_user_for_member "$MEMBER")

# Parse remote URLs from repos.yml
# Format: remote: https://github.com/owner/repo
grep '^\s*remote:' "$REPOS_FILE" | while IFS= read -r line; do
  remote=$(echo "$line" | sed 's/.*remote:\s*//' | xargs)

  # Skip null or empty remotes
  if [[ "$remote" == "null" ]] || [[ -z "$remote" ]]; then
    continue
  fi

  # Extract owner/repo from URL: https://github.com/owner/repo -> owner/repo
  owner_repo=$(echo "$remote" | sed 's|https://github.com/||' | sed 's|\.git$||')

  if [[ -z "$owner_repo" ]]; then
    continue
  fi

  repo_name=$(basename "$owner_repo")
  section_output=""

  # Open PRs
  if [[ "$TEAM_MODE" == "true" ]]; then
    open_prs=$(gh pr list --repo "$owner_repo" --state open --limit 10 --json number,title,author,createdAt,reviewDecision \
      --template '{{range .}}  #{{.number}} {{.title}} ({{.author.login}}) [{{.reviewDecision}}]{{"\n"}}{{end}}' 2>/dev/null || true)
  else
    open_prs=$(gh pr list --repo "$owner_repo" --state open --author "$GH_USER" --limit 10 --json number,title,createdAt,reviewDecision \
      --template '{{range .}}  #{{.number}} {{.title}} [{{.reviewDecision}}]{{"\n"}}{{end}}' 2>/dev/null || true)
  fi

  if [[ -n "$open_prs" ]]; then
    section_output+="Open PRs:"$'\n'"${open_prs}"$'\n'
  fi

  # Recently merged PRs
  if [[ "$TEAM_MODE" == "true" ]]; then
    merged_prs=$(gh pr list --repo "$owner_repo" --state merged --search "merged:>=${SINCE_DATE}" --limit 10 --json number,title,author,mergedAt \
      --template '{{range .}}  #{{.number}} {{.title}} ({{.author.login}}) merged {{.mergedAt}}{{"\n"}}{{end}}' 2>/dev/null || true)
  else
    merged_prs=$(gh pr list --repo "$owner_repo" --state merged --author "$GH_USER" --search "merged:>=${SINCE_DATE}" --limit 10 --json number,title,mergedAt \
      --template '{{range .}}  #{{.number}} {{.title}} merged {{.mergedAt}}{{"\n"}}{{end}}' 2>/dev/null || true)
  fi

  if [[ -n "$merged_prs" ]]; then
    section_output+="Merged PRs (since ${SINCE_DATE}):"$'\n'"${merged_prs}"$'\n'
  fi

  # Open issues
  if [[ "$TEAM_MODE" == "false" ]]; then
    open_issues=$(gh issue list --repo "$owner_repo" --assignee "$GH_USER" --state open --limit 10 --json number,title \
      --template '{{range .}}  #{{.number}} {{.title}}{{"\n"}}{{end}}' 2>/dev/null || true)

    if [[ -n "$open_issues" ]]; then
      section_output+="Open Issues (assigned):"$'\n'"${open_issues}"$'\n'
    fi
  else
    open_issues=$(gh issue list --repo "$owner_repo" --state open --limit 10 --json number,title,assignees \
      --template '{{range .}}  #{{.number}} {{.title}} ({{range .assignees}}{{.login}} {{end}}){{"\n"}}{{end}}' 2>/dev/null || true)

    if [[ -n "$open_issues" ]]; then
      section_output+="Open Issues:"$'\n'"${open_issues}"$'\n'
    fi
  fi

  # Only print section if there's activity
  if [[ -n "$section_output" ]]; then
    echo "=== ${repo_name} (github) ==="
    echo "$section_output"
  fi

done
