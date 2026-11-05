---
id: decision_adr-consolidate-intelligence-graph-into-mgmt
type: decision
title: >-
  ADR: Consolidate Knowledge Graph projection into hey-mgmt with sanitized
  export
created_at: '2026-09-22'
updated_at: '2026-09-22'
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
  - type: supersedes
    target: decision_adr-kg-v2-operating-decisions
sources:
  - kind: doc
    ref: workspace/terence/notes/note_2026-09-14-knowledge-graph-v2-design.md
    title: Knowledge Graph v2 design
  - kind: doc
    ref: content/decisions/decision_adr-kg-v2-operating-decisions.md
    title: 'ADR: Knowledge Graph v2 operating decisions'
---

# ADR: Consolidate Knowledge Graph Projection into hey-mgmt with Sanitized Export

## Context

On 2026-09-14, Decision 1 of `decision_adr-kg-v2-operating-decisions` placed the unified knowledge graph projection in a sibling repository, `hey-mgmt-intelligence`. While intended to protect `hey-mgmt`'s core portable boundary, running the projection in a separate repository introduced significant friction:

1. **Repo-switching overhead:** Humans and agents operating inside `hey-mgmt` had to navigate to `../hey-mgmt-intelligence` to execute `kg` CLI queries, run builds, or validate proposals, then return to `mgmt` to gate them.
2. **Interface fragmentation:** `hey` CLI in `mgmt` and `kg` CLI in `intelligence` were disjoint; `./hey search` and `./hey context compile` could not query the unified projection.
3. **Export requirement:** External consumers, downstream LLM agents, and partner dashboards need an exported knowledge graph. Since `mgmt` is already the primary repository for organizational intelligence (tasks, decisions, playbooks, procedures), hosting the export pipeline directly where knowledge is authored is far cleaner and more maintainable than bridging across multiple repositories.

## Decisions

### 1. Absorb `hey-mgmt-intelligence` into `hey-mgmt`

All projection logic, adapters, query utilities, and procedure guidance engines are integrated directly into `hey-mgmt` under `scripts/lib/intelligence/`.

- Built-in CLI: `./hey graph <build|stats|search|node|neighborhood|backlinks|children|path|isolated|guidance|import-auditor|export>`.
- Standalone compatibility: `scripts/kg.mjs` remains executable for backward-compatible calls (`node scripts/kg.mjs ...`).
- Local projection storage: `.kg/graph.sqlite` and `.kg/graph.jsonl` are generated locally within `hey-mgmt` (gitignored, disposable, rebuildable).

### 2. Sanitized Export (`hey graph export`)

Knowledge graph export is introduced as a first-class feature with strict sanitization boundaries:

- `--scope public` (default):
  - **Excludes:** Personal member workspaces (`workspace/*`), internal meeting notes (`mgmt:meeting`), raw external messages (`ext:slack-*`, `ext:drive-*`), and nodes carrying confidential/internal-only tags (`[Confidential]`, `[InternalOnly]`).
  - **Includes:** Public protocol knowledge (`auditor:*`), onchain analysis research (`oa:*`), playbooks and procedural graphs (`mgmt:playbook`, `proc:*`), and public decisions/notes in `content/`.
  - **Referential Integrity:** All edges touching excluded nodes are automatically purged to prevent dangling edges in the exported dataset.
- `--scope all`: Exports the full internal graph without filtering.
- `--format <jsonl|json|sqlite>`: Emits JSON Lines, formatted JSON, or a standalone self-contained SQLite database.

### 3. Retire Remote `hey-mgmt-io/hey-mgmt-intelligence`

With 100% of capabilities, adapters, and tests ported into `hey-mgmt` and verified, the remote GitHub repository `hey-mgmt-io/hey-mgmt-intelligence` is deleted, and its entry in `content/vocab/repos.yml` is marked `status: retired`.
