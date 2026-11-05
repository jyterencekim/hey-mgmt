---
id: decision_adr-task-status-ready-doing
type: decision
title: >-
  ADR: Task status uses `ready` and `doing` (renamed from `active` and
  `in_progress`)
created_at: '2026-05-20'
updated_at: '2026-05-20'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Documentation
owner: team
status: active
relations:
  - type: mentions
    target: decision_adr-task-done-vs-archived-lif
  - type: mentions
    target: playbook_task-status-lifecycle
sources:
  - kind: doc
    ref: content/playbooks/playbook_task-status-lifecycle.md
    title: Task Status Lifecycle playbook (pre-rename)
  - kind: doc
    ref: scripts/lib/frontmatter-schema.mjs
    title: STATUS_VALUES schema
---

## Context

Until now, a task's lifecycle was: `plan → active → in_progress → done`.
The label `active` meant **ready to claim**, not currently being worked
on. The lifecycle playbook
([`playbook_task-status-lifecycle`](../playbooks/playbook_task-status-lifecycle.md))
had to include an explicit rule warning against the natural reading:

> Do not use "active" as a synonym for "currently being worked." Use
> `in_progress` or "in progress" for that.

When a status name requires a rule against its natural English reading,
the name is wrong. Members and agents consistently misread `active` as
"someone is working on it." Reports, dashboards, and prose had to
re-explain the distinction every time.

`status: active` is also used on non-task artifacts (notes, playbooks,
decisions, meetings, initiatives) to mean **"this artifact is in
force"** — a different concept (artifact lifecycle, not task
lifecycle). The overload of the same word for two different lifecycles
made the schema harder to reason about.

## Decision

**Task lifecycle uses parallel verb forms**:

| Old (task) | New (task) | Meaning |
|------------|------------|---------|
| `plan` | `plan` (unchanged) | Backlog or roadmap. Not committed for execution yet. |
| `active` | **`ready`** | Committed and available to claim. Nobody is currently working on it. |
| `blocked` | `blocked` (unchanged) | Waiting on a dependency. |
| `in_progress` | **`doing`** | Explicitly claimed or actively executing. |
| `done` | `done` (unchanged) | Definition of Done is met. |
| `archived` | `archived` (unchanged) | Closed without completion (see [`decision_adr-task-done-vs-archived-lif`](decision_adr-task-done-vs-archived-lif.md)). |
| `cancelled` | `cancelled` (unchanged) | Withdrawn before meaningful work or duplicate. |

**Non-task artifacts (notes, playbooks, decisions, meetings,
initiatives) keep `status: active`** — there it means "in force /
current," which `active` reads correctly. This rename does NOT touch
those files.

**Schema becomes type-aware**:

- `task` accepts: `plan, ready, blocked, doing, done, archived, cancelled`
- non-task accepts: `active, archived, done, cancelled`

The single shared `STATUS_VALUES` set in
`scripts/lib/frontmatter-schema.mjs` is split into `TASK_STATUS_VALUES`
and `ARTIFACT_STATUS_VALUES` accordingly.

**Hard cut, no dual-accept.** All task files, tooling, apps, slash
commands, and docs migrate in the same commit. After landing, `active`
and `in_progress` on `type: task` fail validation.

## Consequences

- 100 existing task files migrated (96 `active` → `ready`, 4
  `in_progress` → `doing`).
- Tooling updates: `frontmatter-schema.mjs`, `tracker.mjs`,
  `assess.mjs`, `task-ranking.mjs`, `activity-candidates.mjs`,
  `loop-control.mjs` (task branches only — agent-run statuses are
  unchanged), `hey.mjs` (task ops + `new --type task` default).
- App updates: `apps/board/` task UI, filters, tests.
- Slash command updates: every `--status active`, `status='active'`,
  `status IN ('active','in_progress')` reference in `.claude/commands/`.
- Doc updates: `AGENTS.md`, `docs/OPERATING_GUIDE.md`,
  `docs/TEMPLATES.md`, `docs/WORKFLOW_GUIDE.md`.
- Historical artifacts in `workspace/{member}/` daily logs, meeting
  notes, and inbox records are NOT rewritten (per
  [`decision_adr-replace-p0-p3-priority-wit`](decision_adr-replace-p0-p3-priority-wit.md)
  precedent on label changes).
- Agent run records (`work_runs` table) keep their own `status` values,
  including `in_progress`, since "an agent run that is in progress" is
  unambiguous and the run domain is separate from the task domain. A
  task with `status: doing` may have an associated run with
  `status: in_progress`.

## Alternatives Considered

### Keep `active` and `in_progress`, document harder

Rejected. The playbook already documents the distinction and members
still misread. Stronger documentation does not fix a name that requires
warnings.

### Rename `active` only, keep `in_progress`

Rejected. The split between `ready / doing / done` is parallel verb
forms; the split between `ready / in_progress / done` is not. Keeping
`in_progress` means the lifecycle reads mixed (noun adjective / noun
phrase / noun), which makes filters and labels feel uneven.

### Rename `status: active` everywhere (tasks AND non-task artifacts)

Rejected. Non-task `active` means "in force / current" — the natural
English reading. Renaming a playbook to `status: ready` would imply
"ready to be claimed," which is nonsensical for a playbook. The
overload is real and should be split, not unified.

### Dual-accept old and new names during a deprecation window

Rejected. Hard cut is simpler, the migration is mechanical, and
dual-accept invites permanent drift. The repo has fewer than 110 task
files; one-commit migration is feasible.

### Split `status` into two fields (`status` for artifact lifecycle,
`task_status` for tasks)

Rejected for now. A second field is a bigger schema change than the
naming problem demands. Per-type validation in one `status` field is
sufficient, matches the existing pattern at
`frontmatter-schema.mjs:154-160`, and leaves room to revisit if
non-task artifacts ever need a richer lifecycle.

## Rollback

If the rename causes unexpected breakage:

1. Revert this commit (the migration is atomic).
2. The schema, all tooling, all task files, and all docs are restored
   in the same revert.
3. No persistent state outside the repo depends on the new names.
