---
id: playbook_product-initiative-kickoff
type: playbook
title: Product Initiative Kickoff
created_at: '2026-11-03'
updated_at: '2026-11-03'
area: Team
owner: team
status: active
playbook_version: 1.0.0
tags:
  - Product
  - Operations
relations:
  - type: implements
    target: decision_adr-product-initiative-kickoff
sources:
  - kind: doc
    ref: content/decisions/decision_adr-product-initiative-kickoff.md
    title: 'ADR: Product initiative kickoff contract'
  - kind: code
    ref: scripts/lib/product-initiative.mjs
    title: ./hey initiative check | kickoff | alert
---

# Product Initiative Kickoff

## Purpose

Start every product initiative with a shared PRD, a dated plan of
component-level tasks, and a frozen baseline, so the weekly review can show
progress against the plan and any change of scope. Rules:
[`decision_adr-product-initiative-kickoff`](../decisions/decision_adr-product-initiative-kickoff.md).

## Scope

Applies to initiatives with `x_initiative_kind: product`. Business, marketing
and ops initiatives do not use this playbook yet.

## Steps

### 1. Create the initiative in `plan`

```bash
./hey new --type initiative --title "<title>" --owner <member> \
  --field "x_initiative_kind=product"
```

A product initiative starts in `plan`. It becomes `active` only through step 5.

### 2. Write and share the PRD

The PRD is shared with the team before kickoff. It states:

- **Goal:** the outcome and how it will be measured.
- **Why:** the problem, and why this approach over the alternatives.
- **Scope:** what is in and out.
- **Components:** the features or components the work splits into.
- **Task plan:** one deliverable per component, with owner, start and target
  dates.

Link it on the initiative: `x_prd_doc: <url>`. Copy the component names into
`x_components`.

### 3. Set the initiative dates

`x_timeline_start` and `x_timeline_end` (YYYY-MM-DD). `x_timeline_end` is the
target; it is not a `due_date`.

### 4. Create the component tasks

One task per reviewable deliverable of a component. Sub-steps go into that
task's `definition_of_done`, not into separate tasks. Each task carries:

```yaml
relations:
  - type: child_of
    target: initiative_<id>
x_component: <one of x_components>
x_start_date: YYYY-MM-DD
x_target_date: YYYY-MM-DD
```

`/task` asks for these when the parent is a product initiative. Use `due_date`
only for an external commitment.

### 5. Kick off

```bash
./hey initiative kickoff initiative_<id>
```

The command refuses when the dates, PRD link or component list are missing.
It records `x_kickoff_date`, freezes the current tasks into
`x_baseline_tasks`, and moves the initiative from `plan` to `active`.

### 6. Run it

- `./hey initiative check` shows gaps, slips, scope changes and progress per
  component.
- Fisher runs `./hey initiative alert` on weekday mornings. Each owner gets one
  inbox item per initiative with gaps, delivered to Slack. The same missing
  item is reminded at most once a week; an item lists only gaps not reminded
  that week.
- The weekly report shows a red flag for every gap and a scope line for every
  task added or removed after kickoff.

## Changing scope after kickoff

Adding or archiving a task is allowed. It shows in the weekly as a scope change
against the baseline; say why in the weekly. Do not re-run kickoff to hide a
change. The initiative is done when every baseline task, plus every task added
through a shown scope change, is `done` or `archived` with a reason.

## Backfilling an existing product initiative

Initiatives that were active before 2026-11-03 get a validator warning, not an
error. The owner, not an agent, sets `x_initiative_kind` and supplies the PRD,
dates and components. Then do steps 2 to 4, review
`./hey initiative kickoff initiative_<id> --dry-run`, unlink or archive any
linked task that is not part of the agreed plan, and run step 5. Agents MUST
NOT invent dates, components or a retrospective baseline.
