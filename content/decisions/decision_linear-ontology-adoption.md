---
id: decision_linear-ontology-adoption
type: decision
title: 'ADR: Linear ontology adoption — add initiative as 6th artifact type'
created_at: '2026-04-01'
updated_at: '2026-04-01'
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
    target: decision_plans-as-tasks
sources:
  - kind: doc
    ref: .omc/plans/linear-ontology-investigation.md
    title: 'Plan: Linear-Style Ontology Investigation (Revised v2)'
  - kind: doc
    ref: content/decisions/decision_deflate-ontology.md
    title: 'ADR: Deflate artifact ontology from 10 to 5 types'
  - kind: doc
    ref: content/decisions/decision_plans-as-tasks.md
    title: 'ADR: Execution plans as task artifacts with status:plan'
  - kind: doc
    ref: content/playbooks/playbook_operating-philosophy.md
    title: >-
      Operating Philosophy: Principle 2 revised to define initiative/task
      two-tier model
---

## Context

The hey-mgmt repo manages 183+ tasks per month with a flat ontology: every work item is `type: task`, grouped only by a coarse `project` field (Core, Product, App, Infra, Team). This works for discrete deliverables but breaks down for naturally multi-month, multi-task strategic efforts.

The forcing example is `task_crosschain-architecture-contract` — a 120-line task spanning 6 months, 5 contracts, and a full audit cycle. It is de facto an initiative crammed into a single task artifact. Similar unnamed clusters exist: the JPYC Integration group (`task_jpyc-vault-research`, `task_jpyc-vault-code`, `task_jpyc-yield-deploy`) has no formal grouping artifact connecting them.

Three specific gaps drive this decision:

1. No grouping construct between `project` (product area, too coarse) and individual tasks (too fine).
2. `parent_of` / `child_of` are not in `RELATION_TYPES`, so hierarchy cannot be expressed via validated relations.
3. `./hey search --type initiative` is not available; agents cannot enumerate strategic efforts natively.

Linear's ontology (Initiatives > Projects > Issues) offered a reference model. After investigation, the team adopted a simplified two-tier version: initiatives and tasks. The three-tier model (initiative > project > issue) was rejected as unnecessary for a 4-person team — the mid-level "project" layer created a contradictory hybrid where `status: plan` tasks served as de facto types without schema enforcement.

## Options Considered

### Option A: Tags-Only Hierarchy (shadow type system)

Govern tags (`Initiative`, `Project`) plus `parent_of` / `child_of` relations to express hierarchy with no schema changes.

**Pros:** Zero code changes, no new types.

**Cons:** Creates a shadow type system — governed tags that behave like types without schema enforcement. This recreates exactly the problem `decision_deflate-ontology` solved.

**Rejected.**

### Option B: Two New Artifact Types (initiative + project)

Add `initiative` and `project` as first-class types, going from 5 to 7 total types.

**Pros:** Fully mirrors Linear's three-tier model.

**Cons:** Contradicts the spirit of `decision_deflate-ontology`. The `project` field naming collision forces either renaming 183+ task files or living with a confusing overload. The mid-level "Project" tier also introduces disambiguation problems: is JPYC Integration a project or an initiative?

**Rejected.**

### Option C: Rich Vocab (initiatives as YAML vocabulary entries)

Define initiatives as entries in `content/vocab/projects-v2.yml` with metadata (owner, status, timeline).

**Pros:** Zero new types, minimal code changes.

**Cons:** Initiatives need markdown body content, lifecycle tracking, and `definition_of_done`. Vocab files are controlled vocabularies, not stateful entities.

**Rejected.**

### Option D: Three-tier with plan-task mid-level

Add `initiative` as a 6th type; keep `task` with `status: plan` as a mid-level grouping layer between initiatives and leaf tasks.

**Pros:** Reuses existing plan-task pattern.

**Cons:** Creates a contradictory hybrid: Principle 2 says "a task is a task" but then carves out a special class of task that isn't really a task. Mixes type semantics and status semantics, which is exactly the hidden hierarchy the system previously rejected. Also leaves two overlapping concepts ("initiative" the type vs. "plan-task" the convention) for contributors to infer.

**Rejected** after adversarial review.

### Option E: Two-tier — initiative + task (proposed)

Add `initiative` as a 6th type. Tasks link directly to initiatives via `child_of` relations. No mid-level. The model has exactly two work layers: initiatives (strategy) and tasks (work).

```
initiative (type: initiative)
  └── task (type: task)
  └── task (type: task)
  └── task (type: task)
```

## Decision

Adopt Option E. Add `initiative` as the 6th artifact type with a clean two-tier model. Add `parent_of` and `child_of` to the validated `RELATION_TYPES` set. Tasks belong directly to initiatives — no intermediate layer.

The `initiative` type schema:

| Field                  | Requirement                              |
| ---------------------- | ---------------------------------------- |
| `definition_of_done`   | Required                                 |
| `x_timeline_start`     | Optional (extension field)               |
| `x_timeline_end`       | Optional (extension field)               |
| `iteration`            | Forbidden                                |
| `due_date`             | Forbidden                                |
| `relations` (parent_of)| Allowed — links to child tasks           |

Example frontmatter:

```yaml
# content/initiatives/2026/03/initiative_jpyc-integration.md
---
id: initiative_jpyc-integration
type: initiative
title: "JPYC Vault Integration"
created_at: 2026-03-01
updated_at: 2026-04-01
status: active
owner: oliver
project: Product
priority: do
tags:
  - Protocol
definition_of_done:
  - "JPYC vault deployed on mainnet"
  - "Yield strategy live and monitored for 7 days"
relations:
  - type: parent_of
    target: task_jpyc-vault-research
  - type: parent_of
    target: task_jpyc-vault-code
  - type: parent_of
    target: task_jpyc-yield-deploy
---
```

Child tasks add a `child_of` relation:

```yaml
relations:
  - type: child_of
    target: initiative_jpyc-integration
```

## Why Chosen

The decision is grounded in a revision of Operating Philosophy Principle 2 ("Fixed Cadence, Not Flexible Sizing"). The original principle said "instead of adding more work layers (epic, story, task, subtask), keep the model simple." This was correct for preventing within-task fragmentation (no story/subtask/bug distinctions). But it conflated two genuinely different concerns: strategic intent and execution work.

An initiative is not a bigger task — it's a different thing entirely (Golden Principle 4: "One Artifact, One Concern"). An initiative names the strategic intent ("integrate JPYC vaults"). A task names a bounded deliverable ("deploy JPYC yield strategy"). Principle 2 itself prescribes "review against the bigger plan" — the initiative IS that bigger plan.

The two-tier model is clean:

- **Initiatives** are the unit of strategy. They don't belong to iterations. They have `definition_of_done`. They are what weekly output is reviewed against.
- **Tasks** are the unit of work. They fit 1-week iterations. They belong to initiatives via `child_of`.

No mid-level. No `status: plan` serving as a shadow type. No three-hop traversal. One type for strategy, one type for work.

## Naming Convention

Initiative and task titles follow distinct patterns so they are visually distinguishable in lists, search results, and agent output:

- **Initiative titles are noun phrases.** They name the strategic effort, not an action. Example: "JPYC Vault Integration," "CertiK Audit Cycle," "Crosschain Architecture."
- **Task titles are verb phrases.** They name the bounded deliverable or action. Example: "Deploy JPYC yield strategy," "Respond to audit comments," "Implement crosschain keeper."

This is a convention for the `title` field in frontmatter — it does not affect the `id` field. IDs remain kebab-case slugs prefixed by type (`initiative_jpyc-integration`, `task_jpyc-vault-code`).

## Relation Graph Contract

To prevent bad states from day one (per adversarial review):

- **Allowed edges:** `initiative` → (parent_of) → `task`. `task` → (child_of) → `initiative`.
- **Single parent:** A task may have at most one `child_of` relation to an initiative.
- **No nesting:** Initiatives cannot be children of other initiatives. Tasks cannot be parents of other tasks via `parent_of`.
- **No cycles:** Enforced by the above constraints (two-tier graph is acyclic by construction).
- **Reciprocal links optional but recommended:** The initiative carries `parent_of`; the task carries `child_of`. The validator should warn if only one side is present.
- **Orphan tasks allowed:** Not every task needs an initiative. Standalone tasks remain valid.

## Code Changes Required

4 files, approximately 15 lines, 7 touch points:

| File                              | Location                      | Change                                                                                  |
| --------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `scripts/lib/validate.mjs`        | `ID_RE` (line 3)              | Add `initiative` to the type prefix regex                                               |
| `scripts/lib/validate.mjs`        | `RELATION_TYPES` (lines 4-14) | Add `parent_of` and `child_of` to the Set                                               |
| `scripts/lib/validate.mjs`        | `expectedPrefixForType`       | Add `initiative: 'initiative'` mapping                                                  |
| `scripts/lib/validate.mjs`        | `validateTypeSpecific`        | Add `initiative` case: require `definition_of_done`, forbid `iteration` and `due_date`  |
| `scripts/lib/frontmatter-schema.mjs` | `TYPE_FIELDS`              | Add `initiative` field set                                                              |
| `scripts/lib/content-io.mjs`      | `WIKI_LINK_ID_RE` (line 6)   | Add `initiative` to the wiki-link ID regex                                              |
| `scripts/lib/scaffold.mjs`        | `TYPE_CONFIG`                 | Add `initiative` scaffold template entry                                                |

Additional validation rules for the graph contract:

- Warn if a task has more than one `child_of` relation to an initiative
- Warn if `parent_of` source is not `initiative` type or target is not `task` type
- Warn if `child_of` source is not `task` type or target is not `initiative` type

## Migration Path

Migration is phased and non-breaking.

- **Phase 1:** Ship the code changes (add `initiative` type, `parent_of` / `child_of` relations, scaffold template, graph validation rules).
- **Phase 2:** Identify initiative-level clusters from the existing task corpus and create `initiative_*.md` files under `content/initiatives/YYYY/MM/`.
- **Phase 3:** Add `child_of` relations to existing tasks that belong to those initiatives. No existing files are renamed; only a `relations` entry is appended.
- **Phase 4:** New strategic efforts are created as initiatives from day one.

No existing files need their `type` field changed.

## Relations to Prior Decisions

**`decision_deflate-ontology`** — the spirit is honored, not violated. That ADR reduced 10 confusable types to 5 distinct ones. `initiative` serves a genuinely distinct concern (strategic multi-month grouping vs. unit of work). It is not confusable with `task`, `decision`, `meeting`, `playbook`, or `note`.

**`decision_plans-as-tasks`** — remains valid for its original purpose: execution plans for discrete deliverables. Plan-tasks are still tasks. They no longer serve as a mid-level grouping layer — that role moves to `initiative`.

## Consequences

- New directory: `content/initiatives/YYYY/MM/`
- AGENTS.md type table grows from 5 to 6 rows
- `RELATION_TYPES` set expanded with `parent_of` and `child_of`
- `./hey search --type initiative` becomes a valid query
- Existing task clusters will be reorganized under initiatives incrementally
- Graph contract enforced from day one — no deferred safety

## Follow-Ups

1. Implement the code changes listed above.
2. Identify all initiative-level clusters from existing tasks and create initiative artifacts.
3. Add `child_of` relations to existing tasks.
4. Update AGENTS.md type table to include `initiative`.
5. Add `./hey children <initiative-id>` traversal command.
6. Review `tracker.mjs` to exclude `type: initiative` from sprint/iteration metrics.
