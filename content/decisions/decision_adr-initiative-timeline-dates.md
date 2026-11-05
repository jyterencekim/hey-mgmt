---
id: decision_adr-initiative-timeline-dates
type: decision
title: 'ADR: Initiative timeline dates and Scheduled vs Backlog'
created_at: '2026-07-01'
updated_at: '2026-07-01'
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations:
  - type: supports
    target: decision_linear-ontology-adoption
  - type: supports
    target: decision_deflate-ontology
sources:
  - kind: doc
    ref: content/decisions/decision_linear-ontology-adoption.md
    title: >-
      ADR: Linear ontology adoption — defines x_timeline_start/end, forbids
      due_date on initiatives
  - kind: code
    ref: scripts/lib/frontmatter-schema.mjs
    title: >-
      TYPE_FIELDS already permits x_timeline_start/x_timeline_end for
      initiatives (line 60)
  - kind: code
    ref: scripts/lib/indexer.mjs
    title: >-
      buildManifestEntries — x_phase→phase / x_author→author promotion pattern
      (lines 204–212)
  - kind: code
    ref: apps/board/src/lib/types.ts
    title: ManifestEntry — board data shape the timeline view consumes
---

## Context

[`decision_linear-ontology-adoption`](decision_linear-ontology-adoption.md)
(2026-04-01) added `initiative` as the 6th artifact type and defined two optional
extension fields — `x_timeline_start` and `x_timeline_end` — while **forbidding**
`due_date` and `iteration` on initiatives. The timeline fields were specified but
never wired into the pipeline: `buildManifestEntries` promotes only `x_phase→phase`
and `x_author→author` (`scripts/lib/indexer.mjs:204–212`), so any `x_timeline_*`
value survives only inside `meta_json` and is invisible to `index/manifest.jsonl`
and the board `ManifestEntry` type.

Two facts as of 2026-07-01:

1. **0 of 39 initiatives** use `x_timeline_start`/`x_timeline_end` (`grep` over
   `content/initiatives/`). Initiative timing is inferred ad hoc from child-task
   `due_date`s — only ~6 active initiatives have any future-dated child task.
2. A management need has surfaced: view initiatives on a Linear-style **timeline**
   (horizontal date bars) with **expandable child tasks**. That requires a
   queryable initiative date *and* a rule for the majority of initiatives that
   carry no date yet.

The schema already accepts the fields, so `./hey validate` does not block them.
What is missing is (a) pipeline wiring and (b) an agreed semantics for dated vs
undated initiatives. This ADR settles both. It does not reverse the parent ADR;
it operationalizes the timeline fields the parent ADR reserved.

## Decision

**1. Promote `x_timeline_start`/`x_timeline_end` to first-class indexed fields.**
Extract both in `indexer.mjs` (mirroring the `x_phase→phase` line), normalized via
`normalizeDueDate` (strip time; accept `YYYY-MM-DD` or ISO 8601), and surface them
as `timeline_start` / `timeline_end` in the manifest, the SQLite `items` table, and
the board `ManifestEntry`/`Initiative` types. The frontmatter schema needs **no
change** — the fields are already in `TYPE_FIELDS.initiative`.

**2. Semantics — target date plus optional start.**
`x_timeline_end` is the initiative's **target / launch date** (the field members
mean when they say an initiative's "due date"). `x_timeline_start` is **optional**.
Rendering: both present → a **bar**; target only → a **milestone point**.
Initiatives continue to carry **no `due_date`** (unchanged from the parent ADR) —
the timeline signal is `x_timeline_end`.

**3. Scheduled vs Backlog is decided by the explicit target.**
An initiative **with** `x_timeline_end` is **Scheduled** and renders on the
timeline. An initiative **without** it is **Backlog** and renders in a separate
section. For Backlog initiatives a date **derived** from child-task `due_date`s MAY
be shown as a greyed, explicitly-labeled hint — **never** as a timeline bar.
Writing a target date is the explicit act that promotes an initiative onto the
roadmap.

## Scheduled vs Backlog — definitions

| Term | Rule | Timeline rendering |
| --- | --- | --- |
| **Scheduled** | has explicit `x_timeline_end` | bar (if `x_timeline_start` also set) or milestone point |
| **Backlog** | no explicit `x_timeline_end` | listed in a separate section; derived date (max child `due_date`) shown only as a greyed hint |

Rationale: there is no `backlog` status value (statuses are `active` / `done` /
`archived`), so **date-presence is the classification signal**. Deriving a bar for
every initiative from child-task dues would place stale bars in the past (e.g. a
lone April-dated task) and manufacture false precision; keeping derivation as a
hint-only affordance keeps "backlog = not yet committed" honest and makes the
unscheduled gap visible to owners.

## Consequences

- The board can render an initiative timeline, and `./hey db query` can
  filter/sort initiatives by `timeline_end`.
- **Backfill is owner-driven, not auto-written.** The initiative scaffold template
  gains the two fields (new initiatives are prompted from day one); a helper lists
  each active initiative with its derived suggestion; owners set their own targets.
  jared seeds jared-owned initiatives; other owners receive an inbox heads-up with
  the derived suggestion. No mass auto-write — that would fabricate commitments on
  another owner's behalf.
- **Coordination:** the indexer / SQLite / validator touch points sit in terence's
  area (owner of the linear-ontology ADR and the `scripts/lib` pipeline).
  Implementation is coordinated with terence.
- The validator gains a **soft** check: warn when both fields are present and
  `x_timeline_start > x_timeline_end`. Neither field is required.
- Member-facing timeline surfaces lead with the initiative `title`, per
  [`decision_adr-display-task-titles-not-ids`](decision_adr-display-task-titles-not-ids.md).
- **Out of scope (deliberately deferred):** in-UI date editing / write-back
  (fast-follow), and goal linkage + goal swimlanes (a separate ADR — goals will be
  modeled without a new artifact type, honoring `decision_deflate-ontology`).

## Alternatives Considered

- **Add a fresh `target_date` (or re-allow `due_date`) on initiatives** — rejected.
  It duplicates the already-reserved `x_timeline_*` fields and reintroduces
  `due_date`, which the parent ADR forbids for a reason: initiatives are strategy,
  not iteration-bound work items.
- **Derive the timeline for every initiative from child-task dues (no explicit
  field)** — rejected. Produces stale/misleading bars and gives owners no way to
  commit an intentional, visible target.
- **Introduce a `backlog` status value** — rejected. Needs new vocab plus manual
  classification and duplicates the signal that target-presence already carries.
- **Add a `goal`/`project` mid-tier now for grouping** — out of scope, and
  constrained by `decision_deflate-ontology` (avoid confusable type proliferation).
  Goal grouping is a later, lighter-weight change.

## Code Changes Required (for the follow-on build)

| File | Change |
| --- | --- |
| `scripts/lib/indexer.mjs` (~line 204) | Add `timeline_start: normalizeDueDate(fm.x_timeline_start)` and `timeline_end: normalizeDueDate(fm.x_timeline_end)` |
| `apps/board/src/lib/types.ts` | Add `timeline_start` / `timeline_end: string \| null` to `ManifestEntry` |
| `scripts/lib/catalog-db.mjs` | Add two nullable columns to the `items` table |
| `scripts/lib/validate.mjs` | Soft warning when `x_timeline_start > x_timeline_end` |
| `scripts/lib/scaffold.mjs` | Add `x_timeline_start` / `x_timeline_end` to the initiative template |
| `scripts/lib/frontmatter-schema.mjs` | **No change** — fields already permitted |
