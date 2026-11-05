---
id: decision_adr-kb-wide-change-contracts
type: decision
title: 'ADR: KB-wide change contracts with qmd as the primary deps-gate recall channel'
created_at: '2026-08-10'
updated_at: '2026-08-10'
decision_status: accepted
status: active
owner: team
owners:
  - team
tags:
  - Engineering
  - Infrastructure
  - Operations
area: Team
sources:
  - kind: doc
    ref: content/decisions/decision_adr-qmd-local-retrieval-backend.md
    title: 'ADR: Adopt qmd as the local semantic retrieval backend behind hey'
  - kind: doc
    ref: content/notes/2026/06/note_qmd-benchmark-2026-06-02.md
    title: 'QMD benchmark 2026-06-02 (149-query, hybrid MRR 0.714 vs lexical 0.521)'
  - kind: doc
    ref: docs/TEMPLATES.md
    title: Dependency note template (x_change_contract shape)
relations:
  - type: mentions
    target: decision_adr-qmd-local-retrieval-backend
---

## Context

The dependency knowledge base started as nine hand-authored notes under
`content/notes/dependencies/`, each carrying an `x_change_contract`
(triggers → obligations → verification). `./hey deps check` — a MUST-run gate
before change-intent work (`AGENTS.md` Dependency Checks) — matched only those
nine records, out of ~2,560 content artifacts.

Two structural problems surfaced (investigation 2026-08-10):

1. **Coverage cannot scale by hand.** Obligation-bearing knowledge already
   lives across the KB — playbooks with checklists, decisions with
   consequences, notes with "Required Follow-Ups" — but none of it entered the
   gate unless someone duplicated it into a dedicated dependency note.
2. **The authoring burden was mostly retrieval plumbing.** The validator
   required hand-enumerated `triggers.terms[]` (including Korean phrase
   variants) whose only purpose was making *lexical* matching fire. qmd's
   hybrid retrieval makes that unnecessary: MRR 0.714 vs lexical 0.521 on the
   149-query benchmark, and 0.520 vs 0.239 on sentence-style queries
   (`note_qmd-benchmark-2026-06-02`).

## Decision

1. **The contract pool is KB-wide.** Any non-workspace content artifact
   (note, decision, playbook, task) may opt in with the `ChangeImpact` tag +
   `x_change_contract` frontmatter and joins the `deps check` pool.
   `notes/dependencies/` remains a valid home for standalone dependency
   knowledge, but is no longer the only one. Terminal-status artifacts
   (`done`/`archived`/`cancelled`) drop out of the pool: their obligations are
   historical record, not binding checks on new work.
2. **qmd is the primary recall channel for the deps gate — promoted, still
   per-machine optional.** `deps check` runs semantic recall whenever the qmd
   index is available (refreshing it in place when stale). Without qmd it
   degrades to structured + lexical matching, but **loudly**: a stderr notice
   states that recall is degraded and how to enable qmd. The per-developer
   opt-in stance of
   [`decision_adr-qmd-local-retrieval-backend`](decision_adr-qmd-local-retrieval-backend.md)
   is retained, not amended.
3. **`triggers.terms[]` and `intents[]` become optional precision boosters.**
   The validator requires at least one trigger signal of *any* kind
   (repo/path/area/entity/intent/term) plus obligations, but no longer
   requires hand-authored terms. Recall comes from qmd plus full title/body
   lexical matching, which the matcher already performs.
4. **The deterministic obligation layer stays.** Obligations with severity
   (`required`/`recommended`/`watch`), verification checks, Non-Trigger
   Records, and the aggregation consumed by `hey mission compile` remain
   structured and code-evaluated. `mission compile` intentionally stays
   structured + lexical: mission packs are written artifacts and must not vary
   with per-machine qmd state.
5. **Contracts are distilled, not hand-authored, going forward.** The `/clean`
   hygiene checklist gains a distillation step: scan recently updated
   artifacts for obligation-bearing sections lacking a contract and propose
   `x_change_contract` frontmatter as a reviewable diff. The agent extracts;
   the human approves; code checks.

## Alternatives Considered

1. **Status quo (nine notes + mandatory terms).** Rejected: coverage stuck at
   nine records and every new dependency taxed authors with retrieval plumbing
   that qmd does better.
2. **Pure retrieval — retire contracts, let the agent read qmd top-k and infer
   obligations.** Rejected: turns a MUST-run gate probabilistic, loses
   severity semantics, Non-Trigger Records, and the deterministic obligation
   aggregation `mission compile` depends on. If code can answer, code answers.
3. **Make qmd required for the gate.** Deferred: it would amend the accepted
   per-developer opt-in ADR for a ~318 MB install win that the loud fallback
   notice largely delivers. Revisit if degraded-recall notices show real
   misses on non-qmd machines.

## Consequences

### Positive

- Any existing decision/playbook can start binding obligations with a
  frontmatter block — no parallel note to author or keep in sync.
- New contracts need no `terms[]` enumeration; the qmd channel and body-text
  matching carry recall in both languages.
- Non-qmd machines keep working, and now *know* their recall is degraded
  instead of silently missing semantic matches.

### Negative

- Pool membership is broader, so `deps check` precision depends more on the
  acceptance thresholds in `scripts/lib/deps.mjs`; watch for noisy matches as
  contracts spread beyond curated notes.
- Two artifacts can now carry overlapping contracts for the same change
  surface; the `/clean` distillation step is the place to spot and merge
  duplicates.
- Recall quality differs between qmd and non-qmd machines for the same gate;
  the stderr notice surfaces this but does not remove it.
