---
id: decision_adr-kg-v2-operating-decisions
type: decision
title: >-
  ADR: Knowledge Graph v2 operating decisions — procedure representation, gate
  policy, agent identity, links_to deprecation, auditor export, registry upkeep
created_at: '2026-09-14'
updated_at: '2026-09-14'
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Engineering
  - Operations
  - Automation
relations:
  - type: supports
    target: decision_linear-ontology-adoption
  - type: supports
    target: decision_ideas-and-promote-workflow
  - type: supports
    target: decision_deflate-ontology
sources:
  - kind: doc
    ref: workspace/charlie/notes/note_2026-09-14-knowledge-graph-v2-design.md
    title: Knowledge Graph v2 design (Section 9 listed these as open decisions)
  - kind: doc
    ref: workspace/charlie/notes/note_2026-09-14-procedural-graphs-paper-ingest.md
    title: >-
      Procedural Graphs paper ingest (validation gate, rejection memory, small
      graphs)
  - kind: code
    ref: 'https://github.com/hey-mgmt-io/hey-mgmt-intelligence'
    title: >-
      hey-mgmt-intelligence v0 — projection, kg CLI, procedure validator, first
      build metrics
  - kind: doc
    ref: content/playbooks/playbook_auditor-scope-d-deploy.md
    title: First playbook carrying x_procedure_graph (pilot)
---

## Context

The Knowledge Graph v2 design left six decisions open. Decision 1 (where the projection lives) was taken on 2026-09-14: the sibling repo `hey-mgmt-intelligence`. On the same day charlie confirmed decision 2 and delegated 3 through 7 to the agent with the instruction "you decide". This ADR records all of them so Phase 1 can start.

Facts that constrain the choices, from the first build of the projection over this repo:

- 4,679 of 9,436 authored edges (49.6%) are the untyped `links_to` produced by the bare-string `relations:` shorthand.
- 56 relations use off-vocabulary types that the validator only warns about; the projection migrates them on every build.
- `content/vocab/members.yml` already carries `fisher` (`role: agent-runtime`) and a generic `agent` entry, so an agent identity registry exists.
- The `hey-mgmt-io` org has 38 repos; the registry listed 20 before 2026-09-14.
- The pilot procedure graph has 6 nodes; the paper's graphs have 7 to 17.

## Decisions

### D1. Procedure representation: `x_procedure_graph` in playbook frontmatter

Procedural graphs live in the playbook's frontmatter under `x_procedure_graph` (schema `procedural-graph/v0`). No eighth artifact type, by the confusability test of `decision_deflate-ontology`. A sidecar file is permitted only when a graph exceeds 30 nodes, and the playbook MUST then point at it with `x_procedure_graph_file`. Rationale: one file, one owner, one `updated_at`, validated by the same tooling as every other artifact; the paper's evidence favours small graphs, so the ceiling is rarely reached.

### D2. Gate policy: metric where one exists, owner review otherwise

Every edit to an accepted procedure graph enters as `status: proposed`. The gate that turns it into `accepted` depends on the procedure class:

| Procedure class | Gate | Score |
| --- | --- | --- |
| Ceremonies (`/morning`, `/snap`, `/night`, `/sync`, iteration turn) | metric | ceremony completes with `./hey validate` clean; solver steps and tokens not worse than the retained graph over the next 5 runs |
| Auditor and ops-runtime operations (deploy, apply-scope, backfill, hedge lanes) | metric | the operation's own verification (`run_evaluation` verdict, evidence dir `verification-summary.json`, CI green) plus steps and tokens |
| Everything else | owner review | the playbook `owner` accepts or rejects; the reason is written into the proposal |

Ties are accepted, as in the paper's Equation 5. A metric-gated candidate that fails structural validation never reaches rollout. Rejected proposals are kept with `status: rejected` and a `reason`, and every later refinement of the same playbook receives them as negative evidence.

*Addendum 2026-09-14 (charlie).* The gate is a mgmt command, `./hey procedure gate`, because it is the one operation that writes to a playbook. The projection repo `hey-mgmt-intelligence` is read-only against mgmt: it validates (`kg propose`), localizes, and queries, and mgmt imports its validator and edit interface from the sibling checkout so there is one implementation. The one-shot relation/type migration commands were removed from `kg` after they were applied.

### D3. Agent identity: `members.yml` is the only identity registry

Humans are `member:<name>` and agents are `agent:<name>`; both names MUST resolve to an entry in `content/vocab/members.yml`. Agents carry `role: agent-runtime` (Fisher already does). No separate `agents.yml`. Only a `member:` identity may set an edge to `accepted`; an `agent:` identity may only create `proposed` edges or, for imports it produced, `heuristic_signal` edges. The projection rejects an `accepted` edge asserted by an agent at build time and reports it.

*Addendum 2026-09-14 (charlie, while implementing the auditor import).* A third identity class, `system:<name>`, names a deterministic pipeline that has its own promotion gate — today only `system:auditor`, whose facts pass `protocol_knowledge_strict_promotion_gate` before they are exported. Edges asserted by a `system:` identity keep their native strength and status. Facts the auditor holds from `fisher_agent_formalizer` are exported as `agent:fisher` with `heuristic_signal`, because their own caveats say they are source-asserted context, not verifier-confirmed truth.

### D4. `links_to` deprecation: warning for artifacts updated from 2026-09-15, error later

The bare-string shorthand and explicit `links_to` stay valid for the 4,679 existing edges. From 2026-09-15, `./hey validate` warns when an artifact whose `updated_at` is on or after that date carries a bare-string relation, naming the typed alternatives. The projection's `untyped_share` metric is tracked in `kg stats`; when it falls below 30% the warning becomes an error and a one-shot migration types the remainder. Rationale: an immediate error would block every commit on 4,679 edits nobody has time for; a warning scoped to touched artifacts moves the number without a flag day.

### D5. Auditor export: charlie owns it, tracked as a task

charlie owns the auditor's `graph-exchange/v0` export (`export_protocol_knowledge_jsonl` next to the existing `export_*_jsonl` tools), because auditor and observatory work defaults to charlie. Tracked as `task_export-protocol-knowledge-graph-exchange`. Until it lands, the `auditor:` namespace in the projection is empty and the two what-is graphs remain disjoint; the design's Phase 1 exit criterion is not met before this task is done.

### D6. Registry upkeep: creator adds the row the same day; `/clean` diffs weekly

Whoever creates a repo in `hey-mgmt-io` (or adds a repo we work in elsewhere) adds its row to `content/vocab/repos.yml` in the same working day, with `org`, `status`, and a one-line description. `/clean` runs `gh repo list hey-mgmt-io` and reports any org repo missing from the registry and any registry row whose repo is archived or gone. Rationale: the registry drifted to 20 of 38 without a check; a weekly diff costs one command.

### D7. Namespace `oa:` for the onchain-analysis research corpus (added 2026-09-14)

`hey-mgmt-io/onchain-analysis` (511 markdown documents: insights, strategy analyses, risk assessments, knowledge base, whale tracking) joins the projection as the `oa:` namespace. One node per document (`oa:doc:<path>`, kind by top-level directory, freshness anchored on `last_verified` or the last commit date), one node per row of `strategies/catalog.md` (`oa:strategy:S-NNN`). Edges are `mentions` from frontmatter `related:`, relative markdown links, S-NNN ids in paths, and `protocol:` matches onto auditor `market_venue` nodes, all asserted by `agent:onchain-analysis` as `heuristic_signal`. The auditor already cites 477 of these documents as evidence for 3,455 promoted facts; those citations become `evidenced_by` edges, which is the join between research and protocol facts. The corpus stays where it is; `kg` reads it from the sibling checkout and never writes to it.

## Options Considered

- **Eighth artifact type `procedure`.** Rejected: same concept as a playbook in another representation; fails the confusability test.
- **Metric gate for everything.** Rejected: most playbooks have no measurable outcome yet; forcing one would produce fake metrics.
- **Separate `agents.yml`.** Rejected: `members.yml` already resolves Fisher; two registries invite drift.
- **`links_to` as an immediate error.** Rejected: 4,679 edits with no owner; the metric-triggered flip gets the same result without a flag day.
- **Registry check in CI.** Deferred: `gh` auth in CI is not set up for this repo; `/clean` runs weekly with a human present.

## Consequences

- Phase 1 of the design can start. Its exit criterion (isolated nodes under 10%, one query joining auditor facts to mgmt artifacts) depends on D5.
- `scripts/lib/validate.mjs` gains one dated warning (D4). `.claude/commands/clean.md` gains one checklist item (D6).
- The projection (`hey-mgmt-intelligence`) enforces D3 at build time and reports violations.
- The design note's Section 9 is closed; new decisions get their own ADR.

## Follow-Ups

1. `task_export-protocol-knowledge-graph-exchange` (D5).
2. Implement D3 enforcement in the projection's build (reject agent-asserted `accepted` edges).
3. Add the `untyped_share` threshold check that flips D4 from warning to error.
4. First metric-gated proposal round on `playbook_auditor-scope-d-deploy` after five live uses.
