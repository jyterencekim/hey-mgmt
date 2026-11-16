---
name: desk-connectors
description: Connect Slack, Google Drive, Notion, Gmail, Confluence, or GitHub ingestion to hey-mgmt (via host-agent MCP bridge or API tokens) and register recurring sync in the host AI agent's native cron scheduler. Never uses OS launchd or crontab.
---

# External Ingestion Connectors & Agent-Managed Cron

Connect external work signals cleanly into `hey-mgmt` without brittle OS background daemons.

## 1. Inspect Current Connector State

Run:
```bash
./hey connector status --json
```
Also inspect what MCP servers or plugins are already authenticated in the current host AI agent session (for example Slack, Google Drive, Notion, Gmail, or Confluence tools).

## 2. Choose Ingestion Track Per Source

For each source the user wants to enable (`github`, `slack`, `drive`, `notion`, `gmail`, `confluence`), prefer the lowest-friction working path:

### Track A — Host-Agent MCP / Plugin Bridge (`--mode agent-mcp`, Zero New Tokens)
Recommend this first whenever the host AI agent already has an authenticated MCP/plugin for that service:
1. Configure the source in `agent-mcp` mode:
   ```bash
   ./hey connector configure <source> --mode agent-mcp --enable [--channels ... | --folders ... | --repos ... | --databases ...] --json
   ```
2. Verify bridge readiness:
   ```bash
   ./hey connector test <source> --json
   ```
3. Immediately fetch 1–3 recent items using the host agent's MCP/plugin tool and verify end-to-end ingestion:
   ```bash
   echo '[{"source":"<source>","object_id":"...","title":"...","url":"...","summary":"..."}]' | ./hey activity push-events --stdin --owner $MEMBER --prepare --json
   ```

### Track B — API Token / Service Account Collector (`--mode api-token`)
Use this when no host MCP exists or headless CLI polling is preferred:
- **GitHub:** Reuse `gh auth status` session (`./hey connector discover github --json` → select repos → `configure github --mode api-token --repos ...` → `test github`).
- **Slack:**
  1. Run `./hey connector manifest slack --json` and give the user `create_app_url` + JSON manifest to create & install the Slack App.
  2. Accept `SLACK_BOT_TOKEN` (`xoxb-...`), store safely via `./hey connector configure slack --mode api-token --set-env SLACK_BOT_TOKEN=<token>` (never echo tokens back in chat).
  3. Run `./hey connector discover slack --json` to list invited channels and suggest `members.yml` ↔ `slack_user_id` mappings; pass chosen channel IDs via `--channels <csv>` and run `./hey connector test slack`.
- **Google Drive:**
  1. Guide user to create a Google Cloud Service Account JSON key (Drive API + Docs/Sheets/Slides APIs enabled) and share target Drive folders with that `client_email` as **Viewer** (no Workspace domain-wide delegation required for shared folders).
  2. Accept the JSON file path and folder URL(s), then run `./hey connector configure drive --mode api-token --folders "<url-or-id>" --set-env GOOGLE_SERVICE_ACCOUNT_JSON_PATH="<path>"` (the CLI extracts folder IDs automatically).
  3. Run `./hey connector discover drive --json` and `./hey connector test drive --json`.
- **Notion / Confluence / Gmail:**
  1. Configure token/OAuth credentials via `--set-env` (`NOTION_TOKEN`, `ATLASSIAN_*`, or `GMAIL_*`), run `discover` where supported (`notion`), set targets (`--databases`, `--spaces`, `--query`), and run `./hey connector test <source>`.

## 3. Register Agent-Managed Cron (Hard Rule: No OS `launchd` / `crontab`)

Do **NOT** edit macOS `launchd` plists or system `crontab` for member desks. Instead, register recurring ingestion and desk prep inside the user's AI agent scheduler:

1. Render stateless job prompts and schedules:
   ```bash
   ./hey cron render --job all --member $MEMBER --json
   ```
2. Inspect the current AI agent runtime's scheduling capability:
   - **If the host agent has a scheduling tool/skill** (e.g., Antigravity `automation` skill/`/automation`, Claude Scheduled Tasks/`CronCreate`, Hermes `cron`): ask the user which jobs (`activity-sync`, `desk-morning-prep`, `desk-evening-scaffold`) and cadence they want, then create the native scheduled jobs using `cron_with_tz` / `cron`, `cwd`, and `prompt`.
   - **If the host agent configures automations via UI** (e.g., Codex App Automations): output a clean copy-paste card per job containing `[Job Name | Working Directory (cwd) | Schedule (cron_with_tz) | Stateless Prompt]`, then offer to run step 2+ of `activity-sync` once right now as a live smoke test.
