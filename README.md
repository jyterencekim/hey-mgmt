# hey-mgmt

A **Markdown-first Team & Personal Operating System** for humans and AI agents.

All tasks, initiatives, goals, decisions, meetings, playbooks, and notes live as plain `.md` files with YAML frontmatter in Git. `./hey` is the zero-server CLI that validates schema & vocabulary, builds local indexes and knowledge graphs, manages member workspaces and inboxes, and powers an optional local web board (`apps/board` + `apps/api`).

---

## Why `hey-mgmt`?

1. **Plain Markdown + Git is the System of Record** (`OP1`) — No proprietary database or SaaS lock-in. Clone the repo and you have the entire organizational memory, task tracker, and decision graph.
2. **7 Artifact Types, Zero Ontology Bloat** (`ARCH1`) — `task`, `decision`, `meeting`, `playbook`, `note`, `initiative`, `goal`. Everything fits one of these 7 types.
3. **Principles Enforced at Write Time** (`GP1–GP7`) — `./hey validate` checks frontmatter schemas, controlled vocabularies (`content/vocab/`), bidirectional relation targets, source attribution policies (`content/policies/governance.yml`), and product initiative kickoff gates.
4. **Built for Human + Agent Pair Operations** — Slash commands (`/morning`, `/whatnext`, `/sync`, `/snap`, `/night`, `/decide`), inbox notifications (`./hey inbox`), change-impact dependency checks (`./hey deps check`), and Knowledge Graph context packs (`./hey graph context`).
5. **Removable Periphery** (`ARCHITECTURE.md`) — Includes an optional Astro + React management board (`apps/board`), local mutation API (`apps/api`), local SQLite catalog (`.hey/catalog.sqlite`), on-device semantic search (`qmd`), and external activity collectors (`workspace/fisher/`). Delete any of them and the core CLI + Markdown workflow keeps working.

---

## Quick Start (2 Minutes)

### 1. Prerequisites
- **Node.js** `>= 22` (see `.nvmrc`)
- **pnpm** `>= 10`

### 2. Install & Initialize
```bash
pnpm install
cp .env.example .env
# Edit .env to set MEMBER=<your-name> (matching content/vocab/members.yml) and LANGUAGE=ko (or en)

./hey upgrade --yes     # Build indexes, SQLite catalog, and configure git hooks
./hey validate          # Verify repository health
```

### 3. Customize for Your Team or Personal Workspace
1. **Members**: Edit [`content/vocab/members.yml`](content/vocab/members.yml) to add your team members (or just yourself) and create `workspace/<member>/profile.md`.
2. **Areas & Repos**: Edit [`content/vocab/areas.yml`](content/vocab/areas.yml) and [`content/vocab/repos.yml`](content/vocab/repos.yml) for your product areas and code repositories.
3. **Tags & Entities**: Edit [`content/vocab/tags.yml`](content/vocab/tags.yml) and [`content/vocab/entities.yml`](content/vocab/entities.yml) for your domain concepts.
4. **Validate**: Run `./hey validate` and `./hey index build`.

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

# Search & Knowledge Graph
./hey search "onboarding"
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
├── AGENTS.md                 # Cross-agent operating contract & rules
├── CLAUDE.md                 # Claude Code entry point & slash command table
├── SOUL.md                   # Agent identity, values, and boundaries
├── ARCHITECTURE.md           # Portable core vs optional periphery
├── WORKFLOW.md               # Autonomous task runner template
├── hey                       # CLI entrypoint wrapper
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
