# Onboarding Checklist

Welcome to `hey-mgmt`. Follow these steps to spin up your desk with **any AI agent** (Claude Code, Codex, Antigravity, Cursor, OpenCode).

---

## 1. Clone the repo & check prerequisites

Prerequisites:
- **Node.js** `>= 22.5` & **pnpm** `>= 10`
- **Git** (and `gh` CLI optional for GitHub sync)
- (macOS) `brew install sqlite` (optional, for local semantic search `qmd`)

```bash
git clone <repo-url>
cd hey-mgmt
pnpm install
```

---

## 2. Run the Agent-Agnostic Bootstrap Wizard

Open your AI agent in the repository root and paste (or simply say *"set up my desk"*):

> `AGENTS.md와 BOOTSTRAP.md를 읽고 내 작업 환경에 맞게 이 데스크를 세팅해줘.`
> *(English: `Read AGENTS.md and BOOTSTRAP.md and set up this desk for my environment.`)*

Or drive the same deterministic CLI directly:

```bash
./hey setup status --json
./hey setup apply --member <you> --lang en --tone balanced [--prune-starters] --json
```

This safely updates `.env` (preserving existing secrets), registers your member entry in `content/vocab/members.yml`, scaffolds `workspace/$MEMBER/`, scans sibling git clones for `workspace/$MEMBER/repos.yml`, configures `.githooks/` (`pre-commit` validation), builds indexes + SQLite catalog + Knowledge Graph, and runs `./hey validate`.

---

## 3. Connect External Ingestion (Optional)

Link **GitHub**, **Slack**, **Google Drive**, **Notion**, **Gmail**, or **Confluence** via your host agent's existing MCP/plugins (`--mode agent-mcp`) or API tokens (`--mode api-token`):

```bash
./hey connector status --json
./hey connector manifest slack --json         # Prints Slack App Manifest + setup URL
./hey connector discover <source> --json      # Discovers channels, repos, Drive folders, or Notion DBs
./hey connector configure <source> ... --json
./hey connector test <source> --json
```

---

## 4. Register Agent-Managed Cron (No OS `launchd` / `crontab`)

Instead of configuring OS-level background daemons, render stateless schedules and prompts for your AI agent's built-in scheduler (`automation`, Claude Scheduled Tasks, Codex Automations, Hermes):

```bash
./hey cron render --job all --member $MEMBER --json
```

If your laptop sleeps during a scheduled window, `./hey cron preflight` prevents duplicate runs and opening your desk automatically catches up stale connectors.

---

## 5. Fill in Profile & Verify Sibling Repos

- Review `workspace/$MEMBER/profile.md` (domains, repos, preferences) — see [`workspace/alice/profile.md`](../workspace/alice/profile.md).
- Verify `workspace/$MEMBER/repos.yml` (auto-populated from sibling clones beside this repo) and [`content/vocab/repos.yml`](../content/vocab/repos.yml) (`./hey repos list`, `./hey repos resolve "<topic>"`).

---

## 6. Start Your Daily Loop (No Slash Commands Needed)

Talk naturally to your agent — `.agents/skills/desk-daily/SKILL.md` handles the lifecycle automatically:

| Natural Prompt | What Happens |
| --- | --- |
| *"Let's start the day"* / *"출근했어"* | Syncs git, catches up stale connectors, compiles `./hey loop digest --record`, checks inbox & overdue deadlines |
| *"Status check"* / *"진행 기록 남기자"* | Surveys local & GitHub repos, updates `## Plan` checkboxes, logs a timestamped snapshot |
| *"What should I work on next?"* | Inspects loop lanes and claims the next task via `./hey work claim --next` |
| *"Wrap up the day"* / *"퇴근할게"* | Runs `./hey log scaffold`, surveys repos, resolves open threads, validates, commits, and pushes |

---

## 7. Optional Guides & Remote Shared Host

- [`docs/OPERATING_GUIDE.md`](OPERATING_GUIDE.md) — daily workflow and workspace governance
- [`docs/WORKFLOW_GUIDE.md`](WORKFLOW_GUIDE.md) — ceremonies (weekly sync, standups, retros)
- [`docs/EXTERNAL_ACTIVITY_RUNTIME.md`](EXTERNAL_ACTIVITY_RUNTIME.md) — agent-managed cron vs shared Hermes host topology
- [`docs/REMOTE_ACCESS.md`](REMOTE_ACCESS.md) — optional shared Mac Mini SSH / Hermes remote access (`bash scripts/remote-access-setup.sh`)
