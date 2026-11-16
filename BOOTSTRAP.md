# hey-mgmt Desk Bootstrap Wizard

Copy and paste this prompt into **any AI agent** (Claude Code, Codex, Antigravity, Cursor, OpenCode) in this repository root:

> `AGENTS.md와 BOOTSTRAP.md를 읽고 내 작업 환경에 맞게 이 데스크를 세팅해줘.`
> *(or in English: `Read AGENTS.md and BOOTSTRAP.md and set up this desk for my environment.`)*

---

## Execution Contract (For the AI Agent)

Run conversationally without requiring slash commands. Ask **one step at a time**, never invent member/credential values, and perform all mutations through `./hey` CLI subcommands (never overwrite `.env` blindly or install OS `launchd`/`crontab` jobs).

### Step 1 — Diagnose Runtime & Repository State (No Questions Yet)
Run `./hey setup status --json`.
- Verify `node >= 22.5`, `pnpm`, and `git`. If anything is missing or outdated, give OS-appropriate install steps and wait for user approval before installing.
- Note whether `is_starter_state` is `true` (`init` mode for a fresh desk) or `false` (`join` mode for an existing team repo).

### Step 2 — Configure Desk Identity & Sibling Repos
- **`init` mode (new personal/team desk):** Ask for (1) member ID (lowercase), (2) preferred language (`en`, `ko`, `ja`, `zh`, ...), (3) tone (`concise` | `balanced` | `coaching`), (4) primary work areas (or confirm defaults), and (5) whether to prune starter `alice`/`bob` fixtures (`--prune-starters`). Then run:
  ```bash
  ./hey setup apply --mode init --member <id> --lang <lang> --tone <tone> --areas "<csv>" [--prune-starters] --json
  ```
- **`join` mode (existing team repo):** List existing members from `members.human`, confirm whether selecting an existing member or adding a new one plus `language`/`tone`, and run:
  ```bash
  ./hey setup apply --mode join --member <id> --lang <lang> --tone <tone> --json
  ```
- Show detected `sibling_git_repos` written to `workspace/$MEMBER/repos.yml` and ask if any paths need adjustment.
- If `semantic-search` (`qmd`) is off, briefly offer `./hey upgrade --with-optional` (default skip).

### Step 3 — Connect External Ingestion (Optional, One Source at a Time)
Run `./hey connector status --json` and inspect what MCP/plugins are already active in your own agent session. Offer to connect **GitHub**, **Slack**, **Google Drive**, **Notion**, **Gmail**, or **Confluence** (or skip for now):
1. Prefer **Track A (`--mode agent-mcp`)** whenever the host AI agent already has an authenticated MCP/plugin for that service — zero extra tokens needed (`./hey connector configure <source> --mode agent-mcp` + test via `./hey activity push-events --stdin --prepare`).
2. Otherwise guide **Track B (`--mode api-token`)**:
   - **GitHub:** reuse `gh auth status` → `./hey connector discover github --json` → `configure github` → `test github`.
   - **Slack:** `./hey connector manifest slack --json` → user creates app & pastes `xoxb-...` token → `./hey connector configure slack --set-env SLACK_BOT_TOKEN=...` → `./hey connector discover slack --json` to auto-match channels & member IDs → `test slack`.
   - **Google Drive:** create GCP service account JSON, share target Drive folders with `client_email` as Viewer (no Workspace Admin DWD required), paste folder URL(s) + JSON path → `./hey connector configure drive ...` → `discover drive` → `test drive`.
   - **Notion / Gmail / Confluence:** configure credentials via `--set-env`, select targets (`--databases` / `--spaces`), and run `./hey connector test <source>`.

### Step 4 — Register Agent-Managed Cron (No OS `launchd` / `crontab`)
Run `./hey cron render --job all --member $MEMBER --json`.
- If the host agent has a native scheduler (`automation` skill, Claude Scheduled Tasks/`CronCreate`, Hermes `cron`), offer to register `activity-sync`, `desk-morning-prep`, and `desk-evening-scaffold` directly using the rendered schedule and stateless prompt.
- Otherwise print a clean copy-paste card (`cwd`, `cron_with_tz`, `prompt`) for the user's agent automation UI (e.g., Codex Automations) and run a one-time smoke check right away.

### Step 5 — Open Your First Work Desk
Follow `.agents/skills/desk-daily/SKILL.md` (`open` mode): run `./hey loop digest --member $MEMBER --record`, show today's starting brief, and ask what single priority to start with today.
