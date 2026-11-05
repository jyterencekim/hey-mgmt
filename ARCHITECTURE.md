# ARCHITECTURE.md — Core vs Optional Periphery

`hey-mgmt` separates a **portable core** from **optional periphery**.

## Portable Core (Always Required)

The core works with nothing more than a text editor, git, and Node.js:

```text
content/              # Canonical markdown artifacts (7 types)
  tasks/              # YYYY/MM/task_*.md
  initiatives/        # YYYY/MM/initiative_*.md
  goals/              # goal_*.md
  decisions/          # decision_*.md
  meetings/           # YYYY/MM/meeting_*.md
  playbooks/          # playbook_*.md
  notes/              # note_*.md (specs, findings, reports, iteration logs, change contracts)
  vocab/              # Controlled vocabularies (members, areas, repos, tags, entities)
  policies/           # Governance rules (min_refs, ingestion & activity policies)
workspace/{member}/   # Per-member worklogs, notes, inbox, and ideas
scripts/hey.mjs       # CLI: validate, new, search, index, db, graph, inbox, work, loop
scripts/kg.mjs        # Knowledge Graph CLI (also integrated via ./hey graph)
scripts/lib/          # Core library (content-io, indexer, validate, scaffold, tracker, etc.)
docs/TEMPLATES.md     # Artifact templates for humans and agents
AGENTS.md             # Agent instructions (cross-tool)
CLAUDE.md             # Claude Code instructions
SOUL.md               # Agent identity
```

### Core Guarantees

1. **Plain files are the system of record** — Every artifact is a `.md` file with YAML frontmatter. No database, server, or UI is required to read or write artifacts.
2. **`./hey validate` is the single gate** — If validation passes, the repository is consistent.
3. **7 artifact types, no more** — `task`, `decision`, `meeting`, `playbook`, `note`, `initiative`, `goal`. Everything fits one of these.
4. **Derived state is disposable** — `index/` and `.hey/` can be deleted and rebuilt at any time via `./hey index build` and `./hey db build`.

## Optional Periphery (Removable Without Breaking Core)

These modules add convenience or automation on top of the portable core. Removing any of them leaves `./hey validate`, `./hey new`, `./hey search`, and all markdown workflows fully functional:

| Module | Path | Purpose | How to Remove |
|--------|------|---------|---------------|
| Web Board UI | `apps/board/` | Astro + React dashboard for browsing artifacts | `rm -rf apps/board` |
| Local Mutation API | `apps/api/` | Local HTTP server for board inline edits & pulse | `rm -rf apps/api` |
| Autonomous Work Runner | `WORKFLOW.md`, `scripts/lib/tracker.mjs`, `scripts/lib/workspace-mgr.mjs` | Symphony-inspired task claiming & agent dispatch | Ignore or remove `work` subcommands |
| External Activity Runtime | `workspace/fisher/` | Collectors for Slack, Notion, Google Drive, Gmail, Confluence, GitHub | `rm -rf workspace/fisher` |
| Domain Skills | `.claude/skills/` | Specialized workflows & principles | Delete unused skill folders |
| Local SQLite Catalog | `.hey/catalog.sqlite` | SQL queries over manifest | `rm -rf .hey/` |
| Local Semantic Index | `.hey/qmd/` | On-device hybrid vector + BM25 search via qmd | `rm -rf .hey/qmd` |

## Design Rules for New Features

Before adding anything to this repository, check:

1. **Can this be a `note`, `playbook`, `task`, `initiative`, or `goal` instead of a new type or directory?** (Almost always yes.)
2. **Does it require a running server or external service to read/write artifacts?** If yes, it belongs in optional periphery, never in the core workflow.
3. **Are new frontmatter fields needed?** Core fields are fixed (`id`, `type`, `title`, `created_at`, `updated_at`, `status`, `owner`, `area`, `priority`, `tags`, `entities`, `relations`, `sources`, `due_date`, `iteration`, `target_date`). Extension-only fields MUST use the `x_*` namespace.
