# hey-mgmt

A **Markdown-first Team & Personal Operating System** for humans and AI agents.

All tasks, initiatives, goals, decisions, meetings, playbooks, and notes live as plain `.md` files with YAML frontmatter in Git. `./hey` is the zero-server CLI that validates schema & vocabulary, builds local indexes and knowledge graphs, manages member workspaces and inboxes, and powers an optional local web board (`apps/board` + `apps/api`).

---

## Why `hey-mgmt`?

1. **Plain Markdown + Git is the System of Record** (`OP1`) — No proprietary database or SaaS lock-in. Clone the repo and you have the entire organizational memory, task tracker, and decision graph.
2. **7 Artifact Types, Zero Ontology Bloat** (`ARCH1`) — `task`, `decision`, `meeting`, `playbook`, `note`, `initiative`, `goal`. Everything fits one of these 7 types.
3. **Principles Enforced at Write Time** (`GP1–GP7`) — `./hey validate` checks frontmatter schemas, controlled vocabularies (`content/vocab/`), bidirectional relation targets, source attribution policies (`content/policies/governance.yml`), and product initiative kickoff gates.
4. **Built for Any AI Agent Desk (No Slash-Command Lock-In)** — Cross-agent skills under [`.agents/skills/`](.agents/skills/README.md), a universal [`BOOTSTRAP.md`](BOOTSTRAP.md) setup wizard, deterministic `./hey setup` / `./hey connector` / `./hey cron` CLI surfaces, inbox notifications (`./hey inbox`), change-impact checks (`./hey deps check`), and Knowledge Graph context packs (`./hey graph context`).
5. **Removable Periphery** (`ARCHITECTURE.md`) — Includes an optional Astro + React management board (`apps/board`), local mutation API (`apps/api`), local SQLite catalog (`.hey/catalog.sqlite`), on-device semantic search (`qmd`), and external activity collectors (`workspace/fisher/`). Delete any of them and the core CLI + Markdown workflow keeps working.

---

## Quick Start (Any AI Agent, 2–3 Minutes)

### 1. Prerequisites
- **Node.js** `>= 22.5` (see `.nvmrc`)
- **pnpm** `>= 10`
- **Git**

### 2. Install & Launch the Agent-Agnostic Bootstrap Wizard
```bash
git clone <repo-url>
cd hey-mgmt
pnpm install
```

Open **any AI agent** (Claude Code, Codex, Antigravity, Cursor, OpenCode) in this directory and paste:

> `AGENTS.md와 BOOTSTRAP.md를 읽고 내 작업 환경에 맞게 이 데스크를 세팅해줘.`
> *(English: `Read AGENTS.md and BOOTSTRAP.md and set up this desk for my environment.`)*

The agent will run `./hey setup status --json` and guide you step by step:
1. **Identity & Mode (`init` vs `join`)**: Configures `.env`, `content/vocab/members.yml`, `areas.yml`, `workspace/<you>/repos.yml`, indexes, and `.githooks/` (`--prune-starters` cleans up starter `alice`/`bob` samples on new desks).
2. **External Ingestion (`./hey connector`)**: Connects GitHub, Slack, Google Drive, Notion, Gmail, or Confluence via either **your host agent's existing MCP/plugins** (`--mode agent-mcp`, zero new tokens) or **API tokens** (`--mode api-token`), then runs a smoke test.
3. **Agent-Managed Cron (`./hey cron render`)**: Generates stateless schedules & prompts so your **AI agent's own scheduler** handles periodic sync and morning/evening desk prep — no fragile OS `launchd` or `crontab` setup needed.

### 3. Direct CLI Path (Optional)
```bash
./hey setup status --json
./hey setup apply --mode init --member yourname --lang en --tone balanced --prune-starters --json
./hey connector status --json
./hey cron render --job all --json
./hey validate
```

---

## Core CLI (`./hey`)

```bash
# Validate all artifacts, vocabularies, relations, and governance policies
./hey validate

# Create artifacts (task, decision, meeting, playbook, note, initiative, goal)
./hey new --type task --title "Implement webhook signature check" --area Core --owner alice --priority do
./hey new --type decision --title "Adopt SQLite for local catalog" --area Core
./hey new --workspace alice --type note --title "2026-11-05 Worklog"

# List and manage tasks
./hey task list --status ready
./hey task plan task_complete-team-onboarding --date today

# Search, Repo Routing & Knowledge Graph
./hey search "onboarding"
./hey repos list
./hey repos resolve "metrics audit"
./hey deps check "change frontmatter schema"
./hey graph build
./hey graph context task_complete-team-onboarding
./hey graph guidance "commit and push changes"

# Member Inbox
./hey inbox list --workspace alice
./hey inbox send --to bob --title "Review API schema" --body "See [[decision_simplify-frontmatter]]"

# Loop Control & Hygiene
./hey loop brief
./hey loop board
./hey hygiene check
```

---

## Management Web Board (`apps/board` + `apps/api`)

`hey-mgmt` ships with an optional local web UI (Astro + React + Tailwind) and a local mutation API for inline task updates, workspace views, roadmap tracking, and interactive graph exploration:

```bash
# Start both the local API (port 4317) and Board UI (port 4321)
pnpm --dir apps/api dev &
pnpm board:dev
```

Or use `/launch-frontend` in Claude Code. See [`content/playbooks/playbook_launch-management-frontend.md`](content/playbooks/playbook_launch-management-frontend.md) for details.

---

## Core Operating Principles

All contributors (human and AI) follow three foundational documents:
- **Golden Principles (`GP1–GP7`)**: [`content/playbooks/playbook_golden-principles.md`](content/playbooks/playbook_golden-principles.md)
- **Operating Philosophy (`OP1–OP4`)**: [`content/playbooks/playbook_operating-philosophy.md`](content/playbooks/playbook_operating-philosophy.md) ([Korean](content/playbooks/playbook_operating-philosophy.ko.md))
- **Architecture Constraints (`ARCH1–ARCH3`)**: [`ARCHITECTURE.md`](ARCHITECTURE.md)

## Directory Structure

```text
.
├── AGENTS.md                 # Cross-agent operating contract, first-run gate & intent routing
├── BOOTSTRAP.md              # Universal copy-paste bootstrap wizard prompt
├── CLAUDE.md                 # Thin Claude Code entrypoint (@AGENTS.md)
├── SOUL.md                   # Agent identity, values, and boundaries
├── ARCHITECTURE.md           # Portable core vs optional periphery
├── WORKFLOW.md               # Autonomous task runner template
├── hey                       # CLI entrypoint wrapper
├── .agents/skills/           # Canonical cross-agent skills (symlinked into .claude/skills/)
├── content/                  # Canonical shared artifacts (7 types + vocab + policies)
│   ├── decisions/            # Architectural & team decisions (ADRs)
│   ├── goals/                # Company/team goals (human-set)
│   ├── initiatives/          # Strategic initiatives (product, business, marketing, ops)
│   ├── meetings/             # Meeting notes
│   ├── notes/                # Specs, findings, iteration logs, dependency contracts
│   ├── playbooks/            # Runbooks, principles, and style guides
│   ├── policies/             # Governance, meeting ingestion, external activity policies
│   ├── tasks/                # Actionable deliverables (plan/ready/doing/blocked/done/archived)
│   └── vocab/                # Controlled registries (members, areas, repos, tags, entities)
├── workspace/                # Per-member workspaces + fisher collector runtime
│   ├── alice/                # Starter member workspace (profile, inbox, logs, ideas)
│   ├── bob/                  # Starter second member workspace
│   └── fisher/               # Optional external activity collector runtime
├── scripts/                  # CLI implementation & unit tests
├── apps/                     # Optional web frontend (apps/board) & local API (apps/api)
├── docs/                     # Operating guides, templates, and specs
└── .claude/                  # Hooks, slash commands, and core skills
```
