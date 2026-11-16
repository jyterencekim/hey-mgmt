# External Activity Runtime

`hey-mgmt` bridges external activity from Slack, Google Drive, GitHub, Confluence, Notion, and Gmail into the markdown-first core.

## Core Contract

Canonical knowledge lives only in:

- `content/`
- `workspace/`

External ingestion always respects this contract:

- Only `./hey` commands mutate canonical artifacts
- `./hey validate` gates every write (and runs via `.githooks/pre-commit`)
- Ephemeral runtime state, watermarks, and lock files live under `.runtime/` and `.hey/`
- Source references use `x_external_refs`

## Two Supported Execution Topologies

### Mode A — Agent-Managed Cron (Default for Personal & Team Desks)

No OS `launchd`, `crontab`, `pm2`, or dedicated server is required. Each member registers stateless scheduled turns inside **their own AI agent's native scheduler** (Antigravity Automations, Claude Scheduled Tasks, Codex Automations, etc.):

1. Render schedules & prompts: `./hey cron render --job all --member $MEMBER --json`
2. Each scheduled turn executes:
   - `./hey cron preflight --job activity-sync --pull --json` (exits early with `"should_run": false` on cooldown/lock)
   - For `api-token` sources: `FISHER_ACTIVITY_BATCH_NO_GIT_SYNC=1 ./hey activity poll <source>`
   - For `agent-mcp` sources: host agent reads via its connected MCP/plugin tools and pipes normalized JSON into `./hey activity push-events --stdin`
   - `./hey activity prepare-candidates` → LLM classification & reflection → `./hey activity finalize-reflections --data '{...}'`
   - `./hey cron complete --job activity-sync --status ok` → `./hey validate` → scoped git commit & push
3. When a laptop sleeps past a scheduled window, opening the desk (`desk-daily` `open` mode / `./hey connector status --json` / `./hey loop digest`) flags stale watermarks (`> 120m`) and triggers a one-shot catch-up automatically.

### Mode B — Dedicated Always-On Host (Hermes)

For teams running an always-on host (e.g., an office Mac Mini), Hermes owns Socket Mode Slack conversation plus scheduled `hey activity` turns:

| Responsibility | Owner |
| --- | --- |
| Slack DM + allowlisted mentions | Hermes native Slack |
| Scheduled polling / classification / finalize / notify | Hermes cron |
| Moderation buttons and fallback commands | Hermes native Slack |
| Canonical mutations | `node scripts/hey.mjs activity *` |

#### Scheduled maintenance (shared host)

- Run `node scripts/hey.mjs activity auto-compact-knowledge` daily at 03:15 KST to pull `main` and compact `workspace/fisher/knowledge/*.jsonl` when thresholds in `content/policies/external-activity.yml` are met.
- Manual compaction remains available via `node scripts/hey.mjs activity compact-knowledge`.

#### Required Hermes Configuration Example

- Set Slack `groupPolicy` to `allowlist` with your team channel IDs (e.g. `C0123456789`).
- Set the repo-scoped agent id to `hey-mgmt` and workspace to `/path/to/hey-mgmt`.
- Bind Slack allowlisted channels and DMs to the `hey-mgmt` agent.
- Store runtime secrets in `~/.hermes/.env` (or repo-local `.env` for dry-runs via `./hey connector configure`).

## Verification Commands

```bash
./hey connector status --json
./hey cron list --json
./hey validate
node --test scripts/lib/__tests__/activity.test.mjs scripts/lib/__tests__/desk-connectors.test.mjs scripts/lib/__tests__/desk-cron.test.mjs workspace/fisher/external-activity-runtime/lib/*.test.mjs
```
