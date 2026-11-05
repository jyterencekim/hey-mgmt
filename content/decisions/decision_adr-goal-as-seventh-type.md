---
id: decision_adr-goal-as-seventh-type
type: decision
title: 'ADR: Add goal as the 7th artifact type'
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
    target: decision_deflate-ontology
  - type: supports
    target: decision_linear-ontology-adoption
sources:
  - kind: doc
    ref: content/decisions/decision_deflate-ontology.md
    title: 'ADR: Deflate artifact ontology from 10 to 5 types'
  - kind: doc
    ref: content/decisions/decision_linear-ontology-adoption.md
    title: 'ADR: Linear ontology adoption — add initiative as 6th artifact type'
  - kind: doc
    ref: content/tasks/2026/03/task_roadmap-app.md
    title: 'Plan: hey-mgmt App Roadmap — ''## Goal'' = $10M TVL by 2026 Q2 (archived)'
---

## Context

`decision_linear-ontology-adoption` gave the repo a two-tier work model: initiatives (strategy) and tasks (work), linked `initiative` → (parent_of) → `task`. That closed the gap between the coarse `project` field and individual deliverables. But it stopped one layer short. An initiative names *what strategic effort we are running* — it does not name *what outcome that effort exists to move*. There is no artifact for the objective itself.

Today, objectives live only as prose, buried inside tasks. The forcing example is `task_roadmap-app.md` — its `## Goal` section reads "TVL (AUM) $10M by 2026 Q2," and the same target is duplicated into `definition_of_done` as "TVL target $10M by 2026 Q2." That task is `status: archived`. The single most important number the team is steering toward is stranded in an archived task's body, unqueryable, unlinkable, and invisible to any roll-up.

Three specific gaps drive this decision:

1. **No shared objective to link to.** Initiatives cannot express "this effort contributes to $10M TVL." The `contributes_to` relation does not exist, and there is no target artifact for it to point at. Two initiatives that serve the same goal have no way to say so.
2. **No roll-up from work to outcome.** The board can traverse `task` → `initiative`, but the tree dead-ends there. It cannot answer "which initiatives, and therefore which tasks, are moving the TVL goal?" — the exact question a strategy review asks.
3. **Objectives have no lifecycle or single home.** A goal has a target, an owner, a horizon, and a current value that changes over time. Prose in a task body carries none of that as structured, validated fields, and gives objectives no stable id to reference.

`decision_linear-ontology-adoption` already rejected the tempting shortcuts here — governed tags and vocab entries — because a strategic construct needs a markdown body, a lifecycle, and relations that can target it. A goal is the same shape of thing, one tier up. This ADR extends that model rather than reinventing it.

## The tension with deflate-ontology

`decision_deflate-ontology` reduced the ontology from 10 confusable types to 5, and its whole point was to *stop* type proliferation. `decision_linear-ontology-adoption` then went to 6 by arguing `initiative` serves a genuinely distinct concern, not a confusable variant of `task`. Adding a 7th type raises the bar again, and it should.

The test deflate-ontology set is confusability, not count. The question is not "is 7 more than 5?" — it is "can a contributor reliably tell a goal from the six existing types, or will they hesitate at creation time?" A goal is not a bigger initiative any more than an initiative is a bigger task (Golden Principle: One Artifact, One Concern):

- A **goal** names a measurable outcome with a target and a horizon — "$10M TVL by Q2." It is authored by humans, changes rarely, and is what everything below is reviewed against.
- An **initiative** names a strategic effort — "JPYC Vault Integration." It is a bounded body of coordinated work with a `definition_of_done`.
- A **task** names a deliverable — "Deploy JPYC yield strategy." It fits a one-week iteration.

These are three different questions ("what outcome?", "what effort?", "what deliverable?"), so they are three types. `goal` is not confusable with `initiative`, `task`, `decision`, `meeting`, `playbook`, or `note`. The deflate-ontology spirit is honored, not violated — and the mitigations below (strict human-only authoring, a deliberately narrow schema) keep the new type from ever sprawling into a general-purpose bucket.

## Decision

Add `goal` as the 7th artifact type. Goals live at `content/goals/goal_*.md` and are linked from initiatives by a new `contributes_to` relation (`initiative` → (contributes_to) → `goal`), many-to-many, **human-authored only**.

The `goal` type schema is deliberately narrow:

| Field                    | Requirement                                                          |
| ------------------------ | ------------------------------------------------------------------- |
| `title`                  | Required — noun phrase naming the outcome                           |
| `owner`                  | Required — the human accountable for the outcome                    |
| `status`                 | Required — one of `active` \| `hit` \| `missed` \| `archived`       |
| `target`                 | Optional — the committed target value ("$10M TVL"); omit for qualitative core-value goals |
| `metric`                 | Optional — what is measured and its unit ("TVL (AUM), USD")         |
| `current`                | Optional — for financial goals NOT committed here; sourced live from the auditor MCP |
| `target_date`            | Optional — the by-when, as an ISO date ("2026-06-30"); the goal's timebox |
| `definition_of_done`     | Optional — how we'll know it's met, if not fully captured by `target` |
| `iteration`              | Forbidden — goals do not belong to iterations                       |
| `due_date`               | Forbidden — goals express their timebox via `target_date`, not a sprint deadline |
| `relations` (contributes_to) | Reverse side only — the initiative carries `contributes_to`     |

The goal-specific fields (`target`, `metric`, `current`, `target_date`, `definition_of_done`) are all **optional** — this is deliberate. A quantitative goal ("$10M TVL") fills `target`/`metric`/`target_date`; a qualitative core-value goal ("a high risk-adjusted yield product, made incredibly simple") carries only a title and body. One narrow type spans both.

Example frontmatter:

```yaml
# content/goals/goal_jpy-yield-product.md   (flat — goals are undated, like decisions/playbooks)
---
id: goal_jpy-yield-product
type: goal
title: "Scalable ~3% hedged JPY yield product (1-day lockup)"
created_at: 2026-07-01
updated_at: 2026-07-01
status: active
owner: oliver
target: "~3%+ APY, FX-hedged JPY yield, 1-day lockup"
metric: "Net hedged JPY APY, %"
target_date: 2026-09-30
tags:
  - Product
definition_of_done:
  - "JPYC vault live at 3%+ hedged APY with a 1-day lockup and scalable capacity"
---
```

Contributing initiatives add a `contributes_to` relation:

```yaml
relations:
  - type: contributes_to
    target: goal_jpy-yield-product
```

The full tree is now three tiers: `task` → (child_of) → `initiative` → (contributes_to) → `goal`.

```
goal (type: goal)
  └── initiative (type: initiative)          via contributes_to
        └── task (type: task)                via child_of
        └── task (type: task)
  └── initiative (type: initiative)          same goal, different effort
        └── task (type: task)
```

## Options Considered

### Option A: Full artifact type (proposed)

Add `goal` as a first-class type at `content/goals/goal_*.md`, with a narrow schema and a new `contributes_to` relation from initiatives.

**Pros:** Goals get a markdown body, structured lifecycle fields, a stable id, and a validated relation that initiatives can target. Roll-up (`task` → `initiative` → `goal`) becomes a real graph traversal. Consistent with how `initiative` was added one tier down.

**Chosen.**

### Option B: Vocab entry (`content/vocab/goals.yml`)

Define goals as entries in a controlled-vocabulary YAML file with `target` / `owner` / `horizon` metadata.

**Cons:** This is exactly the reasoning `decision_linear-ontology-adoption` used to reject vocab-as-initiatives. Vocab files are *controlled vocabularies, not stateful entities*. Goals need a markdown body (rationale, sub-metrics, links), a lifecycle (`status`), and — critically — relations must be able to *target* them. Validated relations can point at an artifact id; they cannot point at a vocab key. A `contributes_to` edge into `goals.yml#10m-tvl` is not expressible in `RELATION_TYPES`.

**Rejected.**

### Option C: Frontmatter field on initiatives

Add a `goal:` frontmatter field (target + horizon) directly to each initiative, with no separate artifact.

**Cons:** Splits the source of truth. The same "$10M TVL" would be copied into every initiative that serves it, drifting the moment one copy is edited. There is no goal body and no goal lifecycle — the objective can't be owned, discussed, opened, or closed as a thing in its own right. It also inverts the graph: the outcome becomes a property of an effort instead of the effort contributing to an outcome. This is the same trap `task_roadmap-app.md` fell into — the objective smeared across a task body and its `definition_of_done`.

**Rejected.**

## Human-only authoring guarantee

Goals are set by humans. This is not a soft convention — it is a schema-enforced guarantee:

- **Agents draft, never commit.** An agent may propose a goal or draft its body in a workspace, but committing a `goal_*.md` to `content/goals/` is a human action. This is a **policy** guarantee — enforced by the `### Goal Authoring` Ground Rule in `CLAUDE.md` and the exclusions below, not by a validator authorship-provenance check (the validator cannot see who authored a file).
- **Excluded from `/promote` auto-targets.** `/promote` can elevate ideas into `decision`, `playbook`, `task`, or `note`. `goal` is deliberately *not* in the auto-target set. Promotion may surface "this reads like a goal," but a human must create the goal artifact deliberately.
- **The narrow schema is the second guardrail.** Because the type has no general-purpose body role and a fixed field set (target, horizon, owner), it cannot be repurposed as a catch-all — which is what would otherwise erode the deflate-ontology count.

## Financial goals: target committed, current value sourced live

For financial goals (TVL, earnings, APR), the **committed prose holds only the target** — "$10M TVL by 2026 Q2." The **current value is never committed to the goal body.** Committed prose would be stale the moment TVL moves, and stale money numbers are exactly what this repo forbids.

The live current value is sourced from the `hey-mgmt-auditor` MCP, which returns lineage-backed figures with source-observation provenance. When a surface renders TVL-goal progress, the current figure comes from the MCP at render time (custody NAV / TVL query), never from a number typed into `goal_tvl-growth.md`. The goal file is the *contract* (the target); the auditor is the *meter* (the current reading). This keeps the goal artifact human-authored and durable while its progress stays real-time and audit-traceable.

## Relation Graph Contract

To prevent bad states from day one:

- **Allowed edge:** `initiative` → (contributes_to) → `goal`.
- **Direction:** `contributes_to` is carried by the *initiative* (the source), pointing at the goal (the target). Goals do not carry outbound relations to initiatives.
- **Many-to-many:** An initiative may contribute to more than one goal; a goal may be served by many initiatives.
- **No goal nesting:** Goals cannot be children or parents of other goals. There is no `goal` → `goal` edge. Objective hierarchies (OKR-style trees) are explicitly out of scope.
- **The tree is `task` → `initiative` → `goal`.** Tasks never link directly to goals; they reach a goal only through their initiative. This keeps every deliverable's contribution to an outcome mediated by a named effort.
- **Orphans allowed on both sides.** Not every initiative serves a formal goal; not every goal yet has contributing initiatives. Both remain valid.

## Code Changes Required

| File                                 | Location                | Change                                                                                          |
| ------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `scripts/lib/validate.mjs`           | `ID_RE`                 | Add `goal` to the type prefix regex                                                             |
| `scripts/lib/validate.mjs`           | `RELATION_TYPES`        | Add `contributes_to` (and its inverse `advanced_by`) to the Set                                 |
| `scripts/lib/validate.mjs`           | `expectedPrefixForType` | Add `goal: 'goal'` mapping                                                                       |
| `scripts/lib/validate.mjs`           | `validateTypeSpecific`  | Add `goal` case: forbid `iteration` and `due_date` (goal-specific fields are all optional)      |
| `scripts/lib/validate.mjs`           | graph-contract rules    | Warn if `contributes_to` originates from a `goal`, or targets a non-`goal` — the tree is `initiative` → `goal`, no `goal` → `goal` nesting |
| `scripts/lib/frontmatter-schema.mjs` | `TYPE_FIELDS` / status  | Add `goal` field set (`target`, `metric`, `current`, `target_date`, `definition_of_done`); add `GOAL_STATUS_VALUES` = `active` \| `hit` \| `missed` \| `archived` |
| `scripts/lib/content-io.mjs`         | `WIKI_LINK_ID_RE`, `ID_IN_TEXT_RE` | Add `goal` so `[[goal_*]]` wiki-links and inline `goal_` id tokens resolve           |
| `scripts/lib/scaffold.mjs`           | `TYPE_CONFIG`           | Add `goal` (`dir: 'goals'`, flat/undated) so `./hey new goal` scaffolds `content/goals/goal_*.md` |

## Consequences

### Positive

- The team's top-line objectives get a home: `content/goals/`, with stable ids, owners, and horizons — no longer stranded in an archived task body.
- Initiatives can declare what outcome they serve via `contributes_to`, and multiple efforts can point at one goal.
- The board rolls work up to outcomes: `task` → `initiative` → `goal` is a real traversal, so a strategy review can ask "what is moving the TVL goal?" and get an answer from the graph.
- `./hey search --type goal` becomes a valid query.
- Financial goal progress stays real-time and lineage-backed via the auditor MCP, while the target stays human-owned and durable.
- Graph contract enforced from day one — no `goal` → `goal` nesting, no direct `task` → `goal` shortcuts.

### Negative

- The type count grows from 6 to 7, in tension with `decision_deflate-ontology`'s 10 → 5 reduction. **Mitigation:** goals are strictly human-only (schema-enforced, excluded from `/promote`) and carry a deliberately narrow schema (target, horizon, owner), so the type cannot sprawl into a general-purpose bucket — the failure mode deflate-ontology guarded against.
- AGENTS.md type table grows from 6 to 7 rows, and contributors have one more type to learn at creation time. The noun-phrase-outcome shape ("$10M TVL by Q2") is distinct enough from an initiative's effort-noun ("JPYC Vault Integration") to keep the choice unambiguous.
- Financial-goal progress now depends on the auditor MCP being reachable at render time. Surfaces must degrade gracefully (show target-only) when the live current value is unavailable, rather than committing a fallback number.
- A new directory (`content/goals/`) and a new relation (`contributes_to`) expand the surface area that tooling, scaffolds, and the validator must cover.

## Follow-Ups

Done in the change that accompanies this ADR:

1. ✅ Code changes above implemented; `./hey validate` (0 errors) and `./hey index build` green.
2. ✅ Three human-set company goals authored by jared (2026-07-01) from the 2H Focus map: `goal_tvl-growth` (general TVL, no target date), `goal_jpy-yield-product` (Q3), `goal_asian-stablecoin-savings` (Q4). An interim `goal_10m-tvl` seed — migrated from the objective stranded in `task_roadmap-app.md` — was superseded by these and removed.
3. ✅ Eight `contributes_to` relations wired from initiatives to the three goals per the Focus map (JPY-yield product ← JPYC-vault / Yearn-USDT / Morpho-leverage / risk-monitoring; Asian-savings ← auditor / GTM / referral; TVL ← Kaia-vault).
4. ✅ Board goals roll-up view (`pages/goals/`) and the `### Goal Authoring` Ground Rule in `CLAUDE.md`.
5. ✅ AGENTS.md type table updated to include `initiative` and `goal` (now 7 rows).

Remaining:

6. Wire goal-progress surfaces to source the *current* financial value from the `hey-mgmt-auditor` MCP at render time (surfaces are target-only today; `current` is intentionally never committed).
7. Keep `goal` out of `/promote` auto-targets. This is a **policy** guarantee (the `### Goal Authoring` Ground Rule), not a validator check — the validator cannot see authorship. Revisit only if an agent path ever tries to scaffold a goal.
