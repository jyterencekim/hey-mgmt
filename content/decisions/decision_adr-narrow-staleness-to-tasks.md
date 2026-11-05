---
id: decision_adr-narrow-staleness-to-tasks
type: decision
title: >-
  ADR: Narrow GP3 staleness to active tasks; exempt terminal status and
  x_evergreen
created_at: '2026-04-27'
updated_at: '2026-08-10'
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
    target: playbook_golden-principles
sources:
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: Golden Principles GP3 — Keep Artifacts Fresh
  - kind: doc
    ref: content/tasks/2026/04/task_decide-gp3-staleness-scope.md
    title: Decide on narrowing GP3 staleness rule
  - kind: doc
    ref: content/decisions/decision_adr-task-done-vs-archived-lif.md
    title: ADR — Task lifecycle (done vs archived as distinct terminal outcomes)
---

## Context

Golden Principle 3 ("Keep Artifacts Fresh") fires a >90-day staleness
warning on every artifact regardless of type or status. As of
2026-04-27 this produces ~274 warnings out of 279 total — almost
entirely from 2025-era research notes, legal references, meeting
records, and other frozen reference material. The signal-to-noise
ratio is so low that genuine staleness on active tasks is
undetectable.

The 2026-04-24 `/review-principles` pass surfaced this. The triage
question that followed: *"do notes have expiry? they are not to-do's
or something."*

Two related decisions inform the scope:

- `decision_adr-task-done-vs-archived-lif` ratifies that `done`,
  `archived`, and `cancelled` are *terminal* lifecycle outcomes.
  Terminal tasks are closed and not expected to be updated, so
  staleness on them is pure noise.
- The lifecycle ADR also forbids age-based status flips, so the
  cleanup pathway "archive stale done tasks to silence warnings" is
  off the table. The validator must do the right thing on its own.

## Decision

GP3's staleness check applies only when ALL of the following hold:

1. `artifact.type === 'task'`
2. `artifact.frontmatter.status NOT IN { done, archived, cancelled }`
3. `artifact.frontmatter.x_evergreen !== true`

Equivalently:

- **Notes, decisions, meetings, initiatives, playbooks, and other
  non-task artifacts are never flagged as stale.** They capture
  moments or rules; they do not rot on a clock.
- **Terminal-status tasks are never flagged as stale.** Closure is the
  signal; an `updated_at` from six months ago is the *correct* state
  for a finished task.
- **`x_evergreen: true` is the explicit per-artifact opt-out** for
  non-terminal tasks that legitimately span multiple quarters
  (multi-month initiatives, on-call playbooks-as-tasks, long-running
  monitoring tickets).

The 90-day threshold itself is unchanged.

## Implementation

- `scripts/lib/validate.mjs` `validateFreshness()` skips the check
  when any of the three conditions above is true.
- `scripts/lib/audit.mjs` applies the same skip rules when collecting
  `staleArtifacts` for the audit grade. *(2026-08-10: audit.mjs retired by
  [`decision_adr-retire-letter-grade-audit`](decision_adr-retire-letter-grade-audit.md);
  the skip rules now live only in `validate.mjs`, which this ADR continues
  to govern.)*
- `content/playbooks/playbook_golden-principles.md` GP3 is updated to
  state the narrowed scope, the terminal-status exemption, and the
  `x_evergreen` escape hatch.
- `frontmatter-schema.mjs` already accepts arbitrary `x_*` extension
  fields, so no schema change is needed for `x_evergreen`.

## Consequences

- Validator output drops from ~279 warnings to ~5 (the existing
  unknown-`superseded_by` warnings on archived tasks, plus any
  genuinely stale active tasks).
- Audit grade for `note`, `meeting`, `playbook`, `initiative`, and
  `decision` types is no longer dragged down by the staleness penalty.
  The `task` grade is bounded by active tasks, which is the right
  signal.
- Future long-running active tasks (e.g., `task_full-risk-review-execution`,
  multi-quarter initiative trackers) MAY mark themselves
  `x_evergreen: true` to opt out of the freshness clock without
  changing status.
- The historical pattern of "stale notes drown the validate stream"
  ends. `/review-principles` can rely on validator output as a
  high-signal triage surface again.

## Alternatives Considered

### Keep GP3 universal, encourage manual archival of stale notes

Rejected. Manual archival of frozen reference material would either
relabel `done` → `archived` (forbidden by
`decision_adr-task-done-vs-archived-lif`) or move legitimate active
reference notes to `status: archived`, which lies about their
applicability. Both fixes are worse than the noise.

### Narrow to tasks but exempt only `archived`, not all terminal statuses

Rejected. Lifecycle ADR treats `done`, `archived`, and `cancelled` as
equally terminal. Exempting only `archived` would push the team back
toward the forbidden age-based relabeling.

### Drop GP3 entirely

Rejected. Active tasks really do rot. Stale `active` tasks (no
update in 90+ days) are a useful warning that priorities have moved
on without closing the task. Keeping the check on this slice only
recovers the original intent.

### Make `x_evergreen` a general flag (also excludes from audit grading, search boosting, etc.)

Deferred. This ADR scopes `x_evergreen` to staleness only. Adding
broader semantics is a separate decision when a concrete need lands.
