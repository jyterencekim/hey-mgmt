---
id: decision_adr-retire-letter-grade-audit
type: decision
title: 'ADR: Retire the letter-grade entropy audit (hey audit)'
created_at: '2026-08-10'
updated_at: '2026-08-10'
decision_status: accepted
status: active
owner: team
owners:
  - team
tags:
  - Engineering
  - Operations
area: Team
sources:
  - kind: doc
    ref: content/decisions/decision_slug-ids-and-letter-grades.md
    title: Slug-based IDs and letter-only audit grades (grades half superseded here)
  - kind: doc
    ref: content/decisions/decision_adr-loop-control-driver-surface.md
    title: Loop-control driver surface (undated pile lives here)
relations:
  - type: supersedes
    target: decision_slug-ids-and-letter-grades
  - type: mentions
    target: decision_adr-narrow-staleness-to-tasks
---

## Context

`./hey audit` graded every content artifact on a 9-point frontmatter-shape
score (sources, entities, tags, freshness, body length, feedback, relations)
and reported letter grades per artifact, per type, and overall. It was wired
into `/clean`, `/sync`, `/validate`, `/assess`, and the agent quick-reference
tables.

A 2026-08-10 review measured what it actually produced over the full
2,562-artifact corpus:

- **A dead dimension.** The feedback input was a permanent stub
  (`feedbackAgg = {}` — "placeholder until feedback artifact type is
  implemented"), so `no feedback` fired on 2,562/2,562 artifacts and every
  artifact unconditionally lost 1 of 9 points. A+ (9/9) was mathematically
  unreachable; the repo contained zero A+ artifacts.
- **Checks measured unadopted conventions, not quality.** `no entities
  tagged` fired on 94.5% of artifacts, `no outgoing relations` on 41%,
  `no sources` on 39%. A check that ~everything fails describes the
  convention's adoption, not any artifact's quality.
- **Unactionable output.** 659 artifacts (26%) graded C or below; `/clean`
  instructed flagging them. A 659-item list is a list nobody fixes.
- **No behavioral trace.** In four months, no commit tuned the grading
  criteria, and no log, note, or task cites an audit grade as the reason for
  any action.
- **The one real signal was redundant.** The stale list (61 open tasks with
  `updated_at` > 90 days) decomposed exactly into 60 undated tasks — already
  surfaced by the loop board's undated pile
  ([`decision_adr-loop-control-driver-surface`](decision_adr-loop-control-driver-surface.md))
  — plus 1 overdue task, already caught by session-start overdue triage.
  The validation section literally re-ran `./hey validate`.

## Decision

Remove the letter-grade audit wholesale; absorb nothing, because every
non-redundant output already has a better-owned surface:

1. **Delete** `scripts/lib/audit.mjs` and the `./hey audit` command.
2. **`/assess` Health** reports validation state only (errors/warnings via
   `validateRepository`); audit grade, quality distribution, and stale count
   are dropped.
3. **Ceremonies** (`/clean`, `/sync`, `/validate`) and agent docs
   (`AGENTS.md`, `docs/WORKFLOW_GUIDE.md`) drop their audit steps and
   references. Artifact-quality pressure stays where it is actionable:
   `./hey validate` (structural correctness, hard gate), the loop board
   undated pile (rotting-task attention), and session-start overdue triage.
4. **Task-scoped staleness semantics survive** — `isStalenessExempt` lives in
   `validate.mjs` and
   [`decision_adr-narrow-staleness-to-tasks`](decision_adr-narrow-staleness-to-tasks.md)
   continues to govern it; only its audit-side consumer is gone.
5. [`decision_slug-ids-and-letter-grades`](decision_slug-ids-and-letter-grades.md)
   is **partially superseded**: its letter-grade half is retired by this ADR;
   its slug-ID half remains fully in force.

## Alternatives Considered

1. **Fix the metric** (remove the dead feedback dimension, drop the entities
   check, recalibrate thresholds). Rejected: it makes a report nobody reads
   more accurate. Four months of zero behavioral trace is evidence of absent
   demand, not miscalibration.
2. **Keep only the stale list.** Rejected: measured overlap was total
   (60 undated + 1 overdue of 61); a second surface for the same tasks is
   drift waiting to happen.
3. **Keep the command undocumented.** Rejected: dead-but-invocable code paths
   still cost maintenance (the module imported the validator and staleness
   rules) and mislead new members.

## Consequences

### Positive

- Four ceremony surfaces lose a step that produced no decisions; agent docs
  shrink.
- No more unearnable grade dimension silently deflating every artifact.
- Quality signals consolidate onto surfaces with forced action: validator
  errors block, overdue triage demands a verdict per task, the undated pile
  is scored per owner.

### Negative

- Cross-cutting metadata coverage (entities/relations/sources density) loses
  its only aggregate view. If a real consumer for that appears, it should be
  rebuilt against a *lived* convention and a named reader, not resurrected
  as-is.
- `/assess` Health is thinner (validation only); period-over-period quality
  trends were never captured anyway.
