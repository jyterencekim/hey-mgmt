# Operating Guide

Use this repo as a shared markdown system, not an app platform.

## Core Rules

1. Treat `content/` and structured workspace artifacts as the source of truth.
2. Treat `index/` and `.hey/` as disposable local/CI outputs.
3. Link artifacts by ID (`task_*`, `decision_*`, `meeting_*`, `playbook_*`, `note_*`), not by file path.
4. For decision-grade claims, include `sources`.
5. Open PRs with canonical markdown changes only.

## Daily Loop

### 1) Start day

```bash
git pull --rebase origin main
./hey index build
./hey search "" --type task --status ready     # Ready tasks
```

### 2) Do work

1. Create/update artifacts under `content/`.
2. Keep frontmatter current (`status`, `owner`, `relations`, `updated_at`).
3. Add/refresh `sources` when updating decisions or notes.
4. Route raw, unstructured requests into `workspace/{name}/inbox/` via `./hey inbox capture` before promoting them.

### 3) Validate before commit

```bash
./hey validate
```

### 4) Open PR

1. Include the canonical markdown diff.
2. Keep derived files out of the PR unless explicitly needed.
3. Ask reviewers to validate decisions and sources quality first.

## Task Management

Artifact templates: [`docs/TEMPLATES.md`](TEMPLATES.md) — consult for expected frontmatter and body structure.

### File path

`content/tasks/YYYY/MM/task_<slug>.md`

### Minimum task frontmatter

```yaml
id: task_<slug>
type: task
title: <short action title>
created_at: <ISO8601>
updated_at: <ISO8601>
project: <name|null>
status: ready                # Ready to claim, not in progress (see decision_adr-task-status-ready-doing)
priority: plan               # do | plan | routine | drop — see decision_adr-replace-p0-p3-priority-wit for rationale
owner: <name|null>
due_date: <YYYY-MM-DD|null>
iteration: <YYYY-WNN>        # required for ready / blocked / doing tasks
definition_of_done:
  - <testable outcome>
relations: []
sources: []
```

### Status policy

- `ready`: Committed and available to claim. Owner assigned but nobody is currently working.
- `doing`: explicitly claimed or actively executed in the work runner
- `blocked`: waiting on dependency (add `blocked_by`/`blocks`)
- `done`: acceptance criteria complete
- `archived`: old and no longer operational

`active` and `in_progress` were renamed to `ready` and `doing` per
[`decision_adr-task-status-ready-doing`](../content/decisions/decision_adr-task-status-ready-doing.md).
Non-task artifacts (notes, playbooks, decisions, meetings, initiatives) still use `status: active` to mean "in force" — that overload is intentional and documented in the ADR.

Task acknowledgement is separate from status. Use:

```bash
./hey task ack --task <task_id> --note "Saw this; queued behind blocker X"
```

This writes `x_acknowledged.by`, `x_acknowledged.at`, and optional `x_acknowledged.note` in frontmatter. Use it when a task was assigned to you and you want an explicit assignee signal without moving the task into a different lifecycle state.

### Query patterns

Ready tasks:

```bash
./hey search "" --type task --status ready --project Core
```

Doing tasks:

```bash
./hey search "" --type task --status doing --project Core
```

Include external knowledge (Slack, Confluence, Drive, GitHub context):

```bash
./hey search "bridge accounting" --include-knowledge
```

### Semantic search (optional, local qmd)

`./hey search "<query>"` auto-uses a local semantic backend (qmd: BM25 +
vector, RRF-fused) whenever qmd is installed. If the index is stale it is
**refreshed in place first** (incremental, ~2–5 s) and qmd still serves the
result — semantic search is prioritized over a fast-but-worse lexical answer.
Lexical is used only when qmd isn't installed (or a build/query errors).
Empty-query listings (`./hey search "" --type task ...`) are deterministic
filters and **always** use lexical — qmd is never invoked.

```bash
./hey index build --qmd                 # Build/refresh the local semantic index
./hey search "how do we handle oracle fallback"   # Auto: qmd if fresh, else lexical
./hey search "oracle fallback" --backend lexical  # Force lexical
./hey search "oracle fallback" --backend qmd      # Force semantic
```

`--backend auto|lexical|qmd` overrides auto-detect (`auto` is the default).

Once enabled, plain `./hey index build` (run by `/morning`, `/sync`, `/standup`,
`/night`, etc.) **auto-refreshes the qmd index when it is stale** — so it stays
current without remembering `--qmd`. Machines that never ran `--qmd` are
unaffected (no install, no download).

For `./hey deps check "<intent>"`, qmd is the **primary recall channel**
([`decision_adr-kb-wide-change-contracts`](../content/decisions/decision_adr-kb-wide-change-contracts.md)):
it surfaces change contracts whose trigger terms don't lexically overlap your
intent, which is what lets contracts skip hand-enumerated `terms[]` lists.
Structured matches (path/repo/entity) still rank first. Without qmd the gate
degrades to structured + lexical and prints a degraded-recall notice to stderr.
Contracts are KB-wide: any content artifact tagged `ChangeImpact` with
`x_change_contract` enters the pool, not just `content/notes/dependencies/`.

It is **per-developer and opt-in** — building the index is the opt-in signal.
Prerequisites: Node ≥22 and, on macOS, `brew install sqlite`. The first
`./hey index build --qmd` does a one-time ~318 MB embedding-model download to
`~/.cache/qmd/` (machine-global, shared across repos). The index lives in
`.hey/qmd/` (gitignored); the repo behaves identically when qmd is absent. To
uninstall, remove `.hey/qmd/`.

See [`decision_adr-qmd-local-retrieval-backend`](../content/decisions/decision_adr-qmd-local-retrieval-backend.md)
for rationale.

Blocked tasks:

```bash
./hey db build
./hey db query "SELECT id,title,owner FROM items WHERE type='task' AND status='blocked' ORDER BY updated_at DESC;"
```

Decision prep pack:

```bash
./hey context compile --mode decide --intent "Decide sprint priorities" --project Core
```

## Iteration Lifecycle

Team-level iteration logs track goals, milestones, blockers, and decisions across a week:

1. **Open** (`/iteration-open`): Scaffold iteration log at week start with goals and carry-forward.
2. **Log** (`/iteration-add`): Append team-level entries during the week — `[milestone]`, `[blocker]`, `[decision]`, `[coordination]`.
3. **Close** (`/iteration-close`): Generate retrospective summary and carry-forward items at week end.

The `/sync` ceremony is the iteration boundary — it calls `/iteration-close` then `/iteration-open`.

## Weekly Hygiene

1. Archive stale done tasks.
2. Update progress notes with sources.
3. Distill repeated lessons into `content/playbooks/`.
4. Capture retrospective findings as `note` artifacts under `content/notes/`.

## Workspaces

Each member has a personal working area at `workspace/{name}/`.

### Purpose

Workspaces hold personal artifacts: worklogs, scratch notes, individual task progress, and draft analysis. They are the member's space to think, draft, and track personal work before it becomes team-visible.

### What Belongs Where

| Belongs in `workspace/{name}/`  | Belongs in `content/`                    |
| ------------------------------- | ---------------------------------------- |
| Personal notes and worklogs     | Shared tasks with team visibility        |
| Draft analysis before promotion | Decisions (require sources, team review) |
| Individual progress tracking    | Meeting notes (multi-attendee)           |
| Scratch research                | Playbooks (team operating procedures)    |

**Rule of thumb**: If only you need it, it goes in your workspace. If the team needs to see it, coordinate on it, or review it, it goes in `content/`.

### Governance

Workspaces are subject to the same rules as `content/`:

1. **Validation**: `./hey validate` checks workspace artifacts with the same rules (required fields, ID format, relation targets, sources policy).
2. **Vocabulary**: Use names from `content/vocab/` — do not invent new owner, project, tag, or entity values in workspace artifacts.
3. **Golden Principles**: All 7 principles from `content/playbooks/playbook_golden-principles.md` apply to workspace artifacts.

### Bidirectional Linking

Workspaces and root `content/` communicate through the shared artifact graph. Both directions are supported:

- **Workspace → Root**: Reference shared plans and decisions via `[[task_some-id]]` wiki-links or `relations`. This connects your personal work to team coordination.
- **Root → Workspace**: Shared tasks and plans can link to workspace artifacts (e.g., a plan linking to a member's progress note). The indexer includes workspace artifacts in the same manifest, so all cross-references resolve.

Do not duplicate shared content into your workspace — link to it instead.

### Structure

Each workspace contains:

- `README.md` — personal guide and quick reference
- `inbox/` — raw intake queue managed via `./hey inbox ...`
  - `open/` — unread items that still need triage
  - `read/` — acknowledged items kept for follow-up/reference
  - `promoted/` — items already converted into canonical artifacts
  - `discarded/` — items explicitly closed without promotion
- `*.md` — artifacts (notes, tasks, etc.) created via `./hey new --workspace {name}`
- `logs/` — daily continuity log files (`YYYY-MM-DD.md`), created by the `/morning` routine

### Inbox-First Intake

Use the workspace inbox for raw, messy input that is not ready to become a structured artifact yet.

```bash
./hey inbox capture --workspace {name} --title "Slack request" --body "raw text..."
./hey inbox list --workspace {name}
./hey inbox ack --workspace {name} --item <inbox_id>
./hey inbox promote --workspace {name} --item <inbox_id> --type task --title "..."
./hey inbox discard --workspace {name} --item <inbox_id>
```

Inbox statuses are:

- `open` — default queue state for newly captured items
- `read` — acknowledged and removed from the default open scan
- `promoted` — converted into a canonical artifact
- `discarded` — explicitly closed without promotion

`./hey inbox list` shows only `open` items by default. Use `--status <status>` for a single bucket or `--all` to include every status. When an item has `metadata.x_task_ref`, the list output cross-checks the linked task and adds `linked_task`; terminal linked tasks (`done`, `archived`) also get `stale_reason` so stale open inbox items are visible before triage. Use `--no-task-check` only for debugging. Inbox items are not indexed as canonical artifacts until promoted.

### Daily Log Design

Daily logs are not indexed artifacts. They intentionally have no frontmatter `type`, so they stay out of `./hey search`, `./hey context compile`, and the manifest graph. The agent routines (`/morning`, `/check`, `/snap`, `/night`) read them directly by file path and only for narrow continuity windows such as yesterday or today.

Keep raw daily logs as the system of record for personal continuity. If history grows large, compact by adding summary files alongside them rather than deleting, rewriting, or moving the raw files. Dense summaries help historical lookups; raw logs preserve provenance.

Use the built-in compaction commands when history gets heavy:

```bash
./hey log stats
./hey log compact --member jared
./hey log compact --all
```

### Creating Workspace Artifacts

```bash
./hey new --workspace {name} --type note --title "Daily standup notes"
./hey new --workspace {name} --type task --title "Research oracle fallback"
```

Owner is auto-set to the workspace member name by the CLI.

### Promoting Workspace Artifacts to Shared Content

When a workspace artifact becomes team-relevant:

1. Create a new artifact in `content/` using `./hey new --type ...`
2. Copy the relevant content from your workspace draft
3. Add proper sources, relations, and tags
4. Archive or delete the workspace draft

## Command Cheatsheet

```bash
./hey validate
./hey task ack --task task_<slug> --note "Acknowledged"
./hey index build
./hey index watch
./hey db build
./hey db query "SELECT COUNT(*) FROM items;"
./hey search "oracle" --project Core --mode decide
./hey context compile --mode decide --intent "Update roadmap" --project Core
```
