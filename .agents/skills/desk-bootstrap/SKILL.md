---
name: desk-bootstrap
description: Interactive, command-free onboarding and setup wizard for hey-mgmt across any AI agent runtime. Triggers automatically when .env is missing or starter fixtures remain, or when the user asks to set up, initialize, join, or check desk health/upgrades.
---

# Desk Bootstrap Wizard

Guide the member through setting up or upgrading `hey-mgmt` using natural conversation — no slash commands required. Always run `./hey` CLI subcommands instead of hand-editing `.env` or policy YAML files.

## Step 1 — Diagnose Machine & Repo State (Silent Preflight)

1. Run:
   ```bash
   ./hey setup status --json
   ```
2. Check `tools`:
   - Require `node >= 22.5`, `pnpm`, and `git`. If missing or outdated, give the OS-specific install command (`brew install node pnpm`, `nvm install 22`, or `corepack enable`) and ask before running.
   - Note optional tools (`sqlite3` for `qmd` local semantic search; `ttyd` + `tmux` for the `apps/board` embedded terminal).
3. Check `capabilities` and mention any missing core items or behind-main status (`tooling-current`).

## Step 2 — Identity & Mode (`init` vs `join`)

Ask **one concise turn** based on `mode_recommendation`:

- **If `mode_recommendation === "init"`** (fresh template checkout with starter `alice`/`bob` fixtures):
  1. Ask for:
     - **Member ID** (lowercase, e.g. `alex`, `mina`) and optional role
     - **Preferred response language** (`en`, `ko`, `ja`, `zh`, etc.) and tone (`concise` | `balanced` | `coaching`)
     - **Desk scope**: personal solo desk vs team desk, and primary work **areas** (suggest keeping `Product,Core,App,Infra,Team` or customizing)
     - **Prune starter fixtures?** Offer `--prune-starters` (default yes on a new org/personal desk) so `alice`/`bob` samples are cleanly reassigned and removed.
  2. Run:
     ```bash
     ./hey setup apply --mode init --member <id> --role "<role>" --lang <lang> --tone <tone> --areas "<csv>" [--prune-starters] --json
     ```
- **If `mode_recommendation === "join"`** (already active team repository):
  1. Show existing `members.human` from `setup status` and ask whether they are selecting an existing member or adding a new member, plus preferred `language` and `tone`.
  2. Run:
     ```bash
     ./hey setup apply --mode join --member <id> --lang <lang> --tone <tone> --json
     ```

Confirm discovered `sibling_git_repos` (written to `workspace/$MEMBER/repos.yml`) so the user can adjust paths if any working repo lives elsewhere.

## Step 3 — Optional Capabilities (`qmd`)

If `semantic-search` (`qmd`) is off, explain the trade-off (natural-language hybrid search vs ~318 MB one-time model download + `sqlite` on macOS) and ask whether to enable it now (`./hey upgrade --with-optional`) or skip for later.

## Step 4 — External Activity Ingestion & Agent-Managed Cron

Ask if the member wants to connect external sources now (**GitHub**, **Slack**, **Google Drive**, **Notion**, **Gmail**, **Confluence**) or skip to start working immediately.

- If **yes**, hand off to `.agents/skills/desk-connectors/SKILL.md`:
  - Connect one source at a time (`agent-mcp` host plugin bridge or `api-token`), run `./hey connector test <source>`, and register recurring sync via the host AI agent's native scheduler (`./hey cron render --json`).
  - **NEVER** instruct or configure OS `launchd` or `crontab` for personal desks.

## Step 5 — First Desk Open

Once setup succeeds (`validation.errors === 0`), immediately transition into `.agents/skills/desk-daily/SKILL.md` (`open` mode): run `./hey loop digest --member $MEMBER --record`, show today's starting surface, and ask what to focus on first.
