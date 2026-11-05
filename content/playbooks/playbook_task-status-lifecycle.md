---
id: playbook_task-status-lifecycle
type: playbook
title: Task Status Lifecycle
created_at: '2026-04-27'
updated_at: '2026-05-20'
playbook_version: 2.0.0
owner: team
status: active
tags:
  - Operations
  - Documentation
relations:
  - type: mentions
    target: playbook_operating-philosophy
  - type: mentions
    target: playbook_governing-artifact-maintenance
  - type: mentions
    target: decision_adr-task-status-ready-doing
sources:
  - kind: doc
    ref: content/decisions/decision_adr-task-status-ready-doing.md
    title: 'ADR: Task status uses ready and doing'
  - kind: doc
    ref: AGENTS.md
    title: Agent guide task lifecycle
  - kind: doc
    ref: docs/OPERATING_GUIDE.md
    title: Operating guide task status policy
---

# Task Status Lifecycle

## Purpose

Task status names should be readable by humans, agents, and dashboards
without a warning footnote. Each status reads as what it means.

## Status Contract

| Status | Meaning |
|--------|---------|
| `plan` | Backlog or roadmap item, not committed for execution yet. |
| `ready` | Committed and available to claim. Nobody is currently working on it. |
| `blocked` | Waiting on a dependency. Add `blocked_by` or `blocks` relations. |
| `doing` | Explicitly claimed or actively executing. |
| `done` | Definition of Done is met. |
| `archived` | Closed without completion (see [`decision_adr-task-done-vs-archived-lif`](../decisions/decision_adr-task-done-vs-archived-lif.md)). |
| `cancelled` | Withdrawn before meaningful work, or duplicate. Used sparingly. |

The rename from `active` → `ready` and `in_progress` → `doing` landed
2026-05-20 per
[`decision_adr-task-status-ready-doing`](../decisions/decision_adr-task-status-ready-doing.md).
Older artifacts in `workspace/{member}/` logs and meeting notes may
still use the old names in prose — those are not rewritten.

## Lifecycle

```text
plan -> ready -> claim -> doing -> done
                       |
                       v
                   ready (after fail)
```

`blocked` is reachable from `ready` or `doing` when a dependency
emerges; resolution returns it to the prior status.

## Writing Rules

1. Use `status: ready` in frontmatter when a task is committed and
   available to claim. Use `status: doing` when someone has claimed it
   and is working.
2. In prose, reports, and UI, the human label matches the status name:
   "Ready", "Doing", "Blocked", "Done".
3. If a task is assigned but the owner has only acknowledged receipt,
   keep `status: ready` and use `./hey task ack` to record acknowledgement.
4. If ready and doing tasks are grouped together, call the group "open
   execution tasks" or "ready/doing tasks."
5. Tasks with `status` in `ready`, `blocked`, or `doing` MUST declare
   `iteration: YYYY-WNN`.

## Common Queries

```bash
# Ready to claim
./hey search "" --type task --status ready

# Currently being worked
./hey search "" --type task --status doing

# Blocked
./hey search "" --type task --status blocked
```

## Schema

Task status values live in `scripts/lib/frontmatter-schema.mjs` as
`TASK_STATUS_VALUES`. Non-task artifacts (notes, playbooks, decisions,
meetings, initiatives) use a separate `ARTIFACT_STATUS_VALUES` set
where `status: active` still means "in force / current" — that overload
is intentional and documented in the ADR above.

## Agent Run Status (Not Task Status)

`work_runs` records have their own `status` field with values
`in_progress`, `done`, `failed`, etc. An "agent run that is in
progress" is unambiguous and is **not** renamed. A task with
`status: doing` may have an associated run with `status: in_progress`.
