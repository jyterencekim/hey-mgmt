---
id: decision_adr-task-done-vs-archived-lif
type: decision
title: >-
  ADR: Task lifecycle — done vs archived are distinct terminal outcomes, not age
  labels
created_at: '2026-04-27'
updated_at: '2026-04-27'
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
    target: decision_adr-track-dev-task-phase-as-ex
  - type: mentions
    target: decision_simplify-frontmatter
sources:
  - kind: doc
    ref: .claude/commands/clean.md
    title: /clean weekly hygiene checklist (revised 2026-04-27)
  - kind: doc
    ref: scripts/lib/tracker.mjs
    title: tracker terminalStates configuration
  - kind: doc
    ref: 'apps/board/src/pages/me/[member].astro'
    title: Board My Tasks filter
---

## Context

The repo has two terminal task statuses, `done` and `archived`, plus
`cancelled`. The `/clean` weekly hygiene checklist previously proposed
"archive stale `done` tasks older than 14 days" as a routine cleanup
step. Tracing the actual effect through `scripts/lib/tracker.mjs`,
`apps/board/src/pages/me/[member].astro`, `scripts/lib/validate.mjs`,
and `scripts/lib/audit.mjs` revealed the proposal is a no-op:

- The tracker treats `['done', 'archived']` as terminal — same.
- The board UI filters out both — same.
- `validateFreshness` does NOT skip either — both still fire stale
  warnings.
- The audit grade walks all artifacts regardless — same.

There is no surface where `archived` is treated differently from `done`
for an already-terminal task. So flipping `done` → `archived` based on
age changes the label without changing any behaviour, and conflates two
distinct lifecycle outcomes.

## Decision

A task ends in exactly one of three terminal statuses:

| Status | Meaning |
|--------|---------|
| `done` | Task completed. All DoDs met. |
| `archived` | Task closed without completion: superseded, deprecated, no longer applicable, or abandoned. The reason MUST be recorded in the iteration log entry, the task body Progress section, or both. |
| `cancelled` | Task was withdrawn before any meaningful work, or was a duplicate. Used sparingly. |

These are semantically distinct lifecycle outcomes. They are NOT
age-based labels.

**Rules:**

- Do not relabel a `done` task to `archived` based on age. Age is not a
  status. Completion is not abandonment.
- When closing a task without finishing it, choose `archived` and
  record the reason. The most common reasons are: superseded by another
  task or initiative, scope absorbed elsewhere, no longer required,
  unable to deliver, decision reversed.
- When carrying a task across iteration turns, do not change its
  terminal status — only the `iteration` field. (See
  `decision_adr-track-dev-task-phase-as-ex` for handoff state via
  `x_phase`, which is orthogonal to lifecycle.)

## Consequences

- The `/clean` step "archive stale done tasks" was removed (no-op).
- The lifecycle distinction stays informational rather than functional.
  Tooling MAY later add behaviour that depends on the distinction
  (e.g., compress old `archived` tasks to a separate directory, or
  treat `done` as part of velocity rollups but not `archived`), but
  none of that is required by this ADR.
- `MEMORY.md` references this ADR for the canonical statement.
- Any future cleanup script that proposes batched status flips MUST
  cite a real downstream effect, not just label hygiene.

## Alternatives Considered

### Treat `done` and `archived` as interchangeable

Rejected. They encode different facts about the task. Mixing them
loses information that `iteration-close` retrospectives, future
velocity reporting, and post-mortem analysis depend on.

### Add a fourth terminal status for "completed long ago, retained for history"

Rejected. The two existing terminal statuses already partition the
space cleanly. Adding a third for an age axis confuses lifecycle with
recency, which is exactly the mistake this ADR is correcting.

### Make `validateFreshness` skip terminal statuses, then keep the `/clean` cleanup as a way to silence stale warnings

Partial accept. The freshness check should skip terminal task
statuses — but as a fix to `validateFreshness` itself, not as a
status-flip workaround. This is the substance of the GP3 staleness
scope decision (`decision_adr-narrow-staleness-to-tasks`, pending).
