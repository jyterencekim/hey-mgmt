---
id: decision_adr-three-layer-task-timeline
type: decision
title: >-
  ADR: Three-layer task timeline — due_date is the alarm, iteration is the
  commitment, x_planned_date is the schedule
created_at: '2026-08-14'
updated_at: '2026-08-14'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Automation
  - Documentation
owner: team
status: active
relations:
  - type: mentions
    target: decision_adr-loop-control-driver-surface
  - type: mentions
    target: decision_adr-replace-p0-p3-priority-wit
sources:
  - kind: doc
    ref: content/notes/2026/08/note_automated-initiative-task-hygiene-strategy.md
    title: >-
      Automated Initiative and Task Hygiene Strategy (P1, P5, Decisions
      D1/D3/D4)
  - kind: user_request
    ref: 'chat:2026-08-14-task-timeline-and-hygiene-design'
    title: 'In-session ratification of D1/D3/D4 by charlie, 2026-08-14'
---

## Context

Measured on 2026-08-14 (`./hey db query`):

- 307 open tasks; 201 (65%) with no `due_date`, invisible to
  `loop horizon`.
- 24 overdue (oldest 2026-04-24); 21 tasks "due today"; 163 open
  tasks untouched for 30+ days.

One field — `due_date` — carried three meanings: external deadline,
self-schedule, and wish. All three shared a single alarm semantic.
21 tasks "due today" is not a schedule. The cliff-defer pathology
documented in
[`decision_adr-loop-control-driver-surface`](decision_adr-loop-control-driver-surface.md)
(2026-05-27, eight tasks blanket-deferred to one date) recurred.
Session-start triage costs one human decision per overdue item; that
does not survive 24 items — people skip or blanket-defer, which
regrows the pile.

Ratified in-session by charlie on 2026-08-14 as decisions D1, D3,
and D4 of
`note_automated-initiative-task-hygiene-strategy`.
This ADR is the durable record.

## Decision

Split the one overloaded field into three layers with distinct
semantics. The human-perceivable timeline unit is the iteration
(week), not the date.

### Three Layers

| Field | Meaning | Overdue semantics |
| --- | --- | --- |
| `due_date` | Hard external deadline (launch, partner commitment, meeting) | Yes — real alarm; daily triage |
| `iteration: YYYY-WNN` | Weekly commitment, cap 10 per member | No — unfinished work carries forward with a slip count |
| `x_planned_date` | Weekday schedule inside the iteration | None — a missed plan returns to the iteration's unplanned pool |

- `due_date` is the only layer with overdue semantics. It stays in
  daily session-start triage, which becomes small by construction.
- `iteration` is what a member commits to this week. The cap applies
  to iteration membership only; Eisenhower `priority` keeps its
  semantics from
  [`decision_adr-replace-p0-p3-priority-wit`](decision_adr-replace-p0-p3-priority-wit.md)
  unchanged.
- `x_planned_date` is schedule, not deadline. Schedule is cheap to
  move; deadline is expensive to move. The morning view leads with
  today's planned set.

### Field Semantics

Presence of a field carries the meaning. No flag to forget.

- `due_date` present ⇒ external commitment. Alarm on overdue.
- No `due_date`, `iteration` present ⇒ this week's commitment.
- Neither ⇒ backlog.

### Automatic Carry

Ratifies D3. At the iteration boundary (`./hey iteration carry`,
run at `iteration-turn`):

- Unfinished committed tasks carry forward mechanically — no
  per-batch approval. Carry is information-preserving and
  reversible; requiring approval would recreate the pile this design
  removes.
- `x_slip_count` increments on each carry. It is written only by the
  mechanism, never by hand — ledger input, consistent with the
  loop-control ADR's no-`x_attention` rule.
- At `x_slip_count >= 3` the task blocks the ceremony until the
  member decides: re-scope, re-commit with a reason, or archive.
  Blanket carry is not cliff-defer redux because slips are counted
  and forced to a decision.

### Parameters

Ratifies D4. Defaults, tuned from operation, not upfront:

- Weekly commitment cap: 10 per member.

### Backlog health: the definition, and the one number (2026-08-19)

The retired metric was *"count of open tasks with no `due_date`, hold it below
N"*. It is not merely failed, it is invalid: this ADR makes no-due-date the
**normal** backlog state, so the number falls when wish-dates are stripped and
rises when they are added, and moves for reasons unrelated to health. On
2026-08-19, stripping 39 wish-dates took charlie's hard-deadline overdue count
from 45 to 0 without a single task closing — proof the old number measured
conformance to a replaced model.

**Definition.** Backlog health is whether the layer that carries the work is
honest. Under this ADR that layer is the **weekly commitment**, not the date.
An iteration holding many times its cap is not a commitment; it is a list, and
the iteration view built on it is decorative.

**The one number to hold: committed vs cap — open tasks in the current
iteration, per member, against the cap of 10.** Read
`./hey loop health`; it is also printed by `./hey validate`, which runs
unattended on every write.

Deliberately *not* the number:

- **`x_planned_date` coverage.** The schedule layer is an optional override.
  Making coverage the metric would re-create on `x_planned_date` exactly the
  pressure this ADR removed from `due_date`. It is reported as a diagnostic and
  can never fail the check.
- **Backlog size.** A large backlog with no iteration tag is the healthy resting
  state. Nothing about it is debt.

Companion signals, reported alongside but subordinate: `x_slip_count >= 3`
(chronic carry, already gated at the ceremony) and the digest heartbeat, whose
budget is one day — the daily log is the tracked evidence that the scheduled
pass ran, and a stall is reported as the automation stopping rather than as a
skipped day.
- Slip decision threshold: 3.
- `doing` demotion window: 14 days (hygiene check).

### Migration

One-time, batch:

- Open tasks untouched 30+ days lose `due_date` mechanically and
  move to backlog. No per-item decisions.
- Future-dated `due_date` values need member confirmation before
  stripping — some are genuine external deadlines.
- The remainder gets one batch triage pass at the next
  `iteration-turn`: commit to an iteration, keep the date (hard
  deadline only), or backlog.

## Implementation

Landed 2026-08-14, commit `15f41cd01`:

- `./hey iteration carry` — carry plan, `x_slip_count` increment,
  slip-threshold gate (`scripts/lib/iteration-carry.mjs`).
- `./hey hygiene check` — read-only batch detector
  (`scripts/lib/hygiene.mjs`).
- `loop horizon` gained iteration buckets (this / next / backlog),
  sorted `x_planned_date`-first — the precondition before wish-dates
  are stripped.
- Schema checks: `x_slip_count` integer ≥ 0, `x_planned_date`
  ISO date (`scripts/lib/frontmatter-schema.mjs`).

## Consequences

### Positive

- Daily triage shrinks to hard-deadline overdues, small by
  construction.
- The forward view is "my ~10 commitments", not 300 dates.
- Chronic slippage becomes a visible number (`x_slip_count`) instead
  of an invisible habit, with a forced decision at 3.

### Negative

- One-time migration cost, and a confirmation pass for future-dated
  wish-dates.
- `x_planned_date` discipline is a new habit; the cap needs an
  enforcement surface at `iteration-turn`.
- Horizon date buckets go quiet for most tasks; the iteration
  buckets replace them as the primary forward view.

### Out of scope

- Hygiene-check rule details (strategy note P2).
- Fisher ceremony scaffolds (P3/D2 — amendment to the loop-control
  ADR, not this one).
- Packet-loop absorption details (P4) and duplicate merging.

## Alternatives Considered

1. **Single `due_date` plus an `x_hard_deadline` flag** — rejected.
   A forgotten flag leaks noise (wish-date alarms) or silence
   (missed real deadline). Presence-of-field semantics fail safe.

2. **Remove dates entirely; iteration-only** — rejected. Members do
   plan weekdays, and external deadlines are real alarms. The fix is
   splitting the meanings, not removing dates.

3. **Keep per-item daily triage with better discipline** — rejected.
   One decision per item does not survive 24 items; the observed
   response is skipping or blanket-defer, which regrows the pile.

4. **Packets as the anti-cliff-defer device** — superseded.
   Re-surfacing deferred tasks moves to the carry mechanism; the
   packet loop had been dead for two months. Packets remain for
   genuine one-off reminders.
