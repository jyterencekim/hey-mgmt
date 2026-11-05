---
id: decision_adr-product-initiative-kickoff
type: decision
title: >-
  ADR: Product initiative kickoff contract — dates, PRD, component tasks and
  scope baseline
created_at: '2026-11-03'
updated_at: '2026-11-03'
area: Team
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Product
  - Operations
  - Automation
relations:
  - type: supports
    target: decision_adr-initiative-timeline-dates
  - type: supports
    target: decision_adr-three-layer-task-timeline
  - type: implemented_by
    target: playbook_product-initiative-kickoff
sources:
  - kind: doc
    ref: content/meetings/2026/10/meeting_hey-mgmt-weekly-2026-10-28.md
    title: >-
      Oct 28 Team weekly — opaque progress, late design feedback, initiative
      visibility action
  - kind: file
    ref: >-
      content/meetings/2026/10/assets/meeting_hey-mgmt-weekly-2026-10-28/source-sanitized.txt
    title: >-
      Oct 28 transcript — flag initiatives whose docs, timeline or goals are
      undefined
  - kind: doc
    ref: content/decisions/decision_weekly-engineering-review-and.md
    title: >-
      Accepted: organize weekly review around initiatives with docs, timeline,
      goals, tasks, blockers
  - kind: doc
    ref: content/decisions/decision_adr-initiative-timeline-dates.md
    title: x_timeline_start/x_timeline_end semantics; Scheduled vs Backlog
  - kind: doc
    ref: content/decisions/decision_adr-three-layer-task-timeline.md
    title: >-
      due_date = hard external deadline only; iteration and x_planned_date are
      schedule
  - kind: user_request
    ref: claude-code session 2026-11-03
    title: >-
      Jared sets product initiative rules: dates, PRD, component tasks,
      inbox+Slack alerts, weekly red flag, scope-change display
---

## Context

The Oct 28 weekly traced Enfri slippage to late feedback, weak design
agreement and progress nobody could see. The accepted
`decision_weekly-engineering-review-and`
moved the weekly review onto initiatives, but set no minimum for what an
initiative must carry.

As of 2026-11-03, 16 of 73 initiative files carry `x_timeline_start`, none
link a PRD in a dedicated field, and no field separates product work from
business, marketing or operations work. Tasks under one initiative are not
grouped by the component they build, and nothing records which tasks were
planned at kickoff. A product initiative can therefore grow or shrink while
its progress percentage still looks healthy.

Business, marketing and operations work behave differently: completion
often depends on a partner, so a target date cannot always be set. This ADR
covers product initiatives only.

## Decision

### D1. Classify every initiative by kind

Initiatives carry `x_initiative_kind: product | business | marketing | ops`.
The rules below apply only to `product`. Rules for the other kinds are left
to a follow-up ADR.

### D2. A product initiative cannot be `active` without its kickoff contract

Before or at kickoff, a product initiative MUST carry:

| Field | Meaning |
| --- | --- |
| `x_timeline_start` | Initiative start date (required, not optional as in the timeline ADR) |
| `x_timeline_end` | Initiative target date |
| `x_prd_doc` | Link to the shared PRD: goal, why this approach, scope, components, task plan |
| `x_components` | Component or feature list taken from the PRD |
| `x_kickoff_date` | Date the plan was frozen; baseline for scope changes |
| `x_baseline_tasks` | Task ids planned at kickoff |

The PRD MUST be shared with the team and linked before kickoff, not written
afterwards. A new product initiative starts in `plan`;
`./hey initiative kickoff <id>` checks the fields above, records
`x_kickoff_date` and `x_baseline_tasks`, and moves it to `active`. Procedure:
[`playbook_product-initiative-kickoff`](../playbooks/playbook_product-initiative-kickoff.md).

### D3. Product tasks are component-level deliverables with dates

Each task under a product initiative MUST carry:

- `child_of` the initiative,
- `x_component`: one value from the initiative's `x_components`,
- `x_start_date` and `x_target_date`.

A task is a reviewable deliverable of one component. Sub-steps go into that
task's `definition_of_done`, not into separate tasks.

`x_target_date` is the planned finish, not an external deadline. `due_date`
keeps the meaning set by
[`decision_adr-three-layer-task-timeline`](decision_adr-three-layer-task-timeline.md):
it is set only when a partner or launch commitment exists. A missed
`x_target_date` is a weekly slip flag, not a daily overdue item.

### D4. Initiative definition of done = baseline tasks done

A product initiative is done when every task in `x_baseline_tasks`, plus any
task added through a recorded scope change, is `done` or explicitly
`archived` with a reason.

### D5. Scope changes are shown, not absorbed

The weekly report lists, per product initiative, tasks added after
`x_kickoff_date` and baseline tasks removed, archived or unlinked since. The
list is computed as a diff against `x_baseline_tasks`. Scope may change; it
may not change silently.

### D6. Missing items alert the owner through inbox and Slack, and red-flag the weekly

A gap is any of: missing D2 field, product task without `x_component`,
`x_start_date` or `x_target_date`, a `x_component` value not in the
initiative's list, or a passed `x_target_date` on an open task.

- **Inbox + Slack:** a weekday run sends one inbox item per initiative to
  its owner, delivered through Fisher's existing Slack inbox job. Reminders
  dedupe by initiative or task, missing field and recipient: the same missing
  item is reminded at most once a week, and an item lists only the gaps not
  already reminded that week.
- **Weekly report:** every gap renders as a red flag on the initiative card
  with the field to fill.
- **Validator:** new product initiatives created on or after 2026-11-03 fail
  `./hey validate` when D2 fields are missing. Existing ones get a warning
  until the owner backfills them.

## Consequences

- Progress becomes measurable against a fixed plan per component, and scope
  growth is visible in the weekly.
- Kickoff costs more: a PRD and dated task plan are needed before work
  starts. This is the intended cost.
- Owners face new inbox items during backfill. The once-a-week cap on
  repeat alerts limits noise in an inbox that already holds dozens of items.
- Dates in `x_target_date` are estimates; the weekly shows slips, and a slip
  is information, not failure.
- Implemented 2026-11-03: schema and validator rules, indexer fields,
  `./hey initiative check | kickoff | alert`, a hygiene section, `/task` and
  scaffold prompts, the `/weekly-report` red-flag and scope rendering, and the
  board timeline. Alerts reach Slack through Fisher's existing member-inbox
  job once the `hey-mgmt-product-initiative-alert` cron is registered on the
  Mac Mini (`task_register-fisher-product-initia`).
- Existing initiatives are not classified automatically: a missing kind is
  missing information. An agent-drafted proposal for the 51 active
  initiatives (27 product, 13 business, 3 marketing, 8 ops, 9 uncertain) is in
  `workspace/jared/note_initiative-kind-classification-proposal.md` for Jared
  and owners to confirm. Until a kind is set, the validator warns and the
  weekly flags the initiative as unclassified.
- A kickoff baseline is agreed with the owner, not reconstructed by an agent.
  For an existing initiative the owner reviews `./hey initiative kickoff --dry-run`
  and unlinks or archives tasks outside the agreed plan before running it.
- Rules for business, marketing and ops initiatives remain open
  (`task_decide-tracking-rules-for-busi`).

## Alternatives Considered

- **Weekly-report-only red flags.** Rejected: a flag seen once a week arrives
  after a week of untracked work; the owner needs the alert when the gap
  appears.
- **Reuse `due_date` for task finish dates.** Rejected: it would overturn the
  three-layer ADR and refill daily triage with schedule estimates.
- **Infer scope change from `created_at` only.** Rejected: it catches added
  tasks but misses removed or unlinked ones; an explicit baseline list does
  both.
- **One rule for all initiative kinds.** Rejected: partner-dependent
  business work cannot honestly commit to end dates.
