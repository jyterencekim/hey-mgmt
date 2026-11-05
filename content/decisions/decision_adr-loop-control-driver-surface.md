---
id: decision_adr-loop-control-driver-surface
type: decision
title: >-
  ADR: Loop control is the driver surface; tasks, packets, and logs stay as
  ledgers
created_at: '2026-05-27'
updated_at: '2026-08-14'
decision_status: accepted
owners:
  - team
tags:
  - Operations
  - Automation
  - Documentation
sources:
  - kind: doc
    ref: workspace/terence/ideas/2026-04-30-idea-loop-control-workflow-candidate.md
    title: Loop Control Workflow Candidate
  - kind: doc
    ref: workspace/terence/ideas/2026-04-30-idea-scheduled-action-packets.md
    title: Scheduled Action Packets
  - kind: doc
    ref: content/playbooks/playbook_loop-control-usage-guide.md
    title: Loop Control Usage Guide (operational)
area: Team
owner: team
---

## Context

The repo has many ledgers. Tasks hold committed work state. Notes and
playbooks hold durable context. Inbox items hold raw intake and
handoffs. Logs hold transient continuity. Git holds validated change
boundaries. Scheduled action packets hold time-triggered prompts.

These ledgers are pastward and present-tense by construction. Logs
record what happened. Tasks record what is committed. Inbox records
what arrived. None of them, on their own, answer the live question
the human driver actually asks every morning: **"What needs my
attention now, what is moving without me, and what is coming?"**

In April–May 2026 we tried to answer this two ways:

1. **Read everything**: scan the whole `content/tasks/` tree, today's
   commits, the inbox, every running agent. This works for a small
   day; it collapses at any real load. It also pulls the driver into
   transcript granularity (which file? which run? which command?)
   when the actual driver decision is at lane granularity (decide /
   unblock / review / ignore).

2. **Trust the daily log**: lean on `workspace/{member}/logs/` as the
   primary surface. This fails for the opposite reason: logs are
   append-only and pastward. They cannot, by construction, project
   work that hasn't happened yet. The cliff symptom is visible on
   2026-05-27, where eight overdue tasks were blanket-deferred to a
   single future date (`2026-06-05`) — because there was no
   graduated forward view, every "not now" item collapsed onto one
   horizon.

Both failure modes share a cause: the driver was asked to compute the
attention lane themselves, instead of being handed it.

## Decision

**The loop is the driver's primary surface. The ledgers (tasks,
notes, inbox, logs, packets, git) remain the source of truth. The
loop is a projection over them; it stores no durable state of its
own.**

### Three projections, one surface

| Projection | Axis | Answers |
| --- | --- | --- |
| `./hey loop brief` | summary | "What is in flight, what is overdue, what changed since I last looked?" |
| `./hey loop board` | attention lane | "What needs decision / unblock / review / attention right now?" |
| `./hey loop horizon` | due-date window | "What lands today, this week, next week, in two weeks, in a month?" *(2026-08-14: also iteration buckets — see [`decision_adr-three-layer-task-timeline`](./decision_adr-three-layer-task-timeline.md))* |

`brief` is the short scan. `board` is the present-tense attention
view. `horizon` is the forward-tense prospect view. The three are
deliberately separate — combining them produces a wall of detail no
one reads.

### Four driver attention lanes (and what they each demand)

| Lane | Trigger | Driver verb |
| --- | --- | --- |
| Needs decision | judgment cannot be deferred to code, doc, or agent | decide, ask, delegate |
| Needs unblock | dependency, owner, conflict, or input is missing | unblock or reroute |
| Needs review | output exists, awaits human signal | review or assign reviewer |
| Needs attention | overdue, stale, or invalid state | triage or refresh |

Lanes derive from `status`, `phase`, `blocked_by` relations, due
date, and run state. They are not a new field. If the derivation
misses real intent, fix the derivation rule — do not add
`x_attention` as a manual override. The lane is the *output* of the
ledger state, never the input.

### Packets carry future prompts, not future work

A scheduled action packet says *"re-surface this at time T."* It is
not a task. The boundary:

- If the future moment requires substantive work, **create a task**
  with a `due_date`. The horizon projection will surface it.
  *(2026-08-14: superseded in part — commit the task to an `iteration`
  instead; `due_date` only for hard external deadlines, per
  [`decision_adr-three-layer-task-timeline`](./decision_adr-three-layer-task-timeline.md).)*
- If the future moment is a reminder, light check, or
  agent-readable follow-up, **create a packet**. It surfaces in the
  brief (when due) and horizon (always).
- A packet may *point* to a task. A packet must not *replace* one.

This boundary is the reason packets are not a "second task system."
Treating them as one collapses the distinction the loop relies on.

### The loop carries no state the ledgers don't

The brief, board, and horizon are recomputed every time they run.
There is no `loop.db`, no `attention.json`, no checkpoint file. This
is enforced by composition: every projection is a function of
manifest + inbox + packet list + run attempts, all of which live in
git or in workspace files. If you delete the loop tooling tomorrow,
no information is lost.

This rule is what lets us evolve the lane derivation, add new
projections (like horizon), and change formatting without migrating
data.

## Consequences

### Positive

- The driver scans lanes and windows, not transcripts. The cost of
  morning routine becomes O(lanes + horizon buckets), not O(tasks).
- Forward visibility is no longer dependent on memory or grep.
  Horizon makes "due in 14 days" a first-class view.
- The ledgers remain authoritative. Promoting an idea, closing a
  task, sending an inbox item — all still produce immediate loop
  effects because the loop reads them directly.
- Adding a projection is cheap. `loop horizon` (2026-05-27) added
  two functions and one subcommand; no schema changes, no
  migrations.

### Negative

- Derived lanes mean the driver sometimes disagrees with the
  derivation ("this is not really blocked, the blocker is stale").
  The fix is to clean the ledger (close stale blockers, refresh
  `updated_at`, fix invalid `phase`), not to override the lane.
- Horizon quality is exactly as good as `due_date` hygiene. The
  `No due date` bucket on 2026-05-27 contains 41 tasks. That pile
  is a forcing function — it makes the gap visible — but it is
  also a reminder that "the tool only works if the inputs are
  clean."
- Three commands instead of one. The morning routine runs `brief`,
  `board`, `horizon`. We accept this as cheaper than one
  ever-growing wall.

### Out of scope (explicitly)

- The loop does not claim, mutate, or close tasks. Those go through
  `./hey work claim`, the task body, or `./hey inbox`.
- The loop does not run agents. Agent execution is the harness
  domain (`initiative_harness-v1-execution-harness`).
- The loop does not write to the daily log. The daily log is
  authored by `/morning`, `/snap`, `/night`; the loop is a read
  surface those skills consume.

## Alternatives Considered

1. **One mega-board with lanes and a time axis** — rejected.
   Combining attention and horizon produces a 2D grid no one reads
   on a phone or in Slack. Two separate views are easier to scan
   and easier to evolve independently.

2. **A persistent attention store with an `x_attention` field on
   every task** — rejected. Adds a new field that gets stale, needs
   migration, and lets the ledger and the loop disagree. Derivation
   from existing fields keeps the loop honest.

3. **Treat packets as tasks with `kind: reminder`** — rejected. The
   "if it's real work, make it a task" rule depends on packets being
   structurally different. Unifying them dilutes the rule and turns
   packets into a backdoor for noise.

4. **Auto-populate the daily log with horizon data on every
   `/snap`** — rejected for now. The log is pastward; injecting
   forward data into it duplicates state and confuses the
   audit trail. The loop is read on demand; the log records what
   happened with it.

## Amendment (2026-08-14)

Per D2 of
`note_automated-initiative-task-hygiene-strategy`
(terence pilot):

- **Fisher may author scaffold sections** of ceremonies and daily
  logs — clearly marked, containing pastward facts only: commits,
  activity, run outcomes. It may also precompute digests (morning
  brief, iteration pre-package). The "out of scope" rule above is
  narrowed accordingly: the mechanical half of `/morning`, `/snap`,
  `/night` may be Fisher-written.
- **Judgment lines remain member-authored.** Reflections, decisions,
  priorities, archival — never Fisher.
- **The alternative-4 rejection stands, narrowed to forward-tense
  data.** It targeted injecting *forward* (horizon) data into a
  pastward log, and that stays rejected: forward data lives in the
  digest, never the log. Pastward-fact scaffolds record what
  happened — exactly what the log is for.
- **Packets are consumed by the morning digest**, restoring the
  re-surfacing loop.

## Amendment (2026-08-19) — "never the log" is superseded by the removal of `digests/`

The 2026-08-14 amendment above held that **forward data lives in the digest,
never the log**. That rule is retired, because its premise no longer exists:
terence removed the `digests/` directory, and `workspace/<member>/logs/YYYY-MM-DD.md`
is now the single durable record. A rule that routes forward data to a home that
was deleted has no referent — it does not constrain, it just fails.

The *concern* behind alternative 4 was never location. It was that injecting
machine-written forward state into a member-authored pastward record duplicates
state and confuses the audit trail. That concern is preserved by ownership
rather than by separate files:

- The scheduled `loop digest --record` pass writes **only** between
  `<!-- fisher:digest:start -->` and `<!-- fisher:digest:end -->`, alongside the
  scaffold's own marker pair. Each unattended writer owns one region and nothing
  else, so machine-written and member-written content stay separable inside one
  file.
- The digest section is explicitly labelled a forward-looking projection and
  machine-owned, and it **never emits a `## Plan`**. A plan is a commitment, and
  commitments remain member-authored — the "judgment lines remain
  member-authored" rule is unchanged and is what this preserves.

**Why the change was needed at all.** With an ephemeral delivery as its only
output, the pass left the repo unable to answer *"did management run today?"*.
That question is the whole point of the ceremony crons, and it must be
answerable without invoking `/morning` or reading `hermes cron list` — both of
which are themselves rituals, and rituals are the failure mode the 2026-W33
retrospective identified. A log carrying the digest section but no `## Plan` is
now a precise, readable statement: the machine ran, the member has not committed
to a day. The 21:30 double-check in `workspace/fisher/ceremony-crons.md` reads
exactly that distinction.

## Relations

- Promotes the rationale from
  [`note_2026-04-30-loop-control-workflow-candidate`](../../workspace/terence/ideas/2026-04-30-idea-loop-control-workflow-candidate.md)
  and
  [`note_2026-04-30-scheduled-action-packets`](../../workspace/terence/ideas/2026-04-30-idea-scheduled-action-packets.md)
  into a permanent team ADR.
- Operational usage lives in
  [`playbook_loop-control-usage-guide`](../playbooks/playbook_loop-control-usage-guide.md).
- Lane derivation references the priority semantics in
  [`decision_adr-replace-p0-p3-priority-wit`](./decision_adr-replace-p0-p3-priority-wit.md).
