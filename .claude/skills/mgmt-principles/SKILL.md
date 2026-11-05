---
name: mgmt-principles
description: Enforces hey-mgmt writing principles, style guide, Golden Principles, and qmd change-contract dependency gates.
owner: terence
applies_to: [hey-mgmt, operations]
updated: 2026-09-29
---

# Team Mgmt Principles & Authoring Guide

Designed and established by Terence as the core operating principles, writing standards, and retrieval harness for `hey-mgmt`. Use this skill when authoring, modifying, or reviewing any markdown artifacts, tasks, decisions, or change-intent workflows in this repository.

---

## 1. Repository Architecture & Contract

- **System of Record**: Plain Markdown + YAML frontmatter + Git. Canonical artifacts live strictly in `content/` (shared) and `workspace/{member}/` (personal). Never hand-edit derived indexes (`index/`, `.hey/`).
- **7 Artifact Types Only**: `task`, `decision`, `meeting`, `playbook`, `note`, `initiative`, `goal`.
- **Operating Philosophy (OP1–OP4)**:
  - **OP1 — Shared Ledger, Personal Agents**: Everyone and every agent reads and writes the same git-backed markdown ledger. Tooling and interfaces are interchangeable.
  - **OP2 — Fixed Cadence, Not Flexible Sizing**: Work is fixed to 1-week iterations (`iteration: YYYY-WNN`) for execution (`task`), and multi-month strategic tracking for `initiative`. If a task cannot finish in one week, split it.
  - **OP3 — Inbox-First Chaos Containment**: Raw intake goes to `workspace/{member}/inbox/`. Triage, classify, tag, and link before promoting to canonical `content/` or discarding.
  - **OP4 — Instructing the Repo Is Teaching Ourselves**: Improving an artifact teaches the entire team. When behavior or policy changes, update the governing artifact in the same commit (`playbook_governing-artifact-maintenance.md`).

---

## 2. Writing Style: "짧고 Clear하고 명확하게"

Follow `content/playbooks/playbook_style-guide.md` (English) and `content/playbooks/playbook_style-guide.ko.md` (Korean):

- **Concise & Direct**: Short sentences; cut needless words. Prefer active voice and positive statements. Avoid filler ("basically", "actually", "매우", "사실은").
- **One Idea, One Concern**: One idea per sentence; one topic per paragraph.
- **Headings**: 1–3 words, Title Case, no trailing punctuation.
- **Tone**: Direct, neutral, instructional. State rules firmly rather than asking rhetorical questions.
- **Normative Keywords**: Capitalize normative keywords (MUST / SHOULD / MAY) per RFC 2119.
- **Vocabulary Compliance**: Always use registered values from `content/vocab/` (`members.yml`, `projects.yml`, `tags.yml`, `entities.yml`). Never invent ad-hoc vocab. Non-standard frontmatter fields MUST use the `x_*` namespace.

---

## 3. Golden Principles (GP1–GP7 Self-Review Checklist)

Before submitting or committing any artifact, verify all seven Golden Principles (`content/playbooks/playbook_golden-principles.md`):

1. **GP1 — No Unattributed Claims**: Decision-grade claims MUST cite `sources`. Unsourced claims belong in a `note` with a hypothesis tag.
2. **GP2 — Shared Vocabulary**: Tags, entities, and owner values must strictly match registries in `content/vocab/`.
3. **GP3 — Keep Active Tasks Fresh**: Open tasks stale >90 days must be reviewed, updated, closed, or marked `x_evergreen: true`.
4. **GP4 — One Concern**: An artifact covers a single topic. If a task exceeds 3 acceptance criteria, split it.
5. **GP5 — Relations Over Duplication**: Do not duplicate information across files. Link via frontmatter `relations:` (`supports`, `implements`, `links_to`, `child_of`, `parent_of`).
6. **GP6 — Sources Chain Completeness**: Decisions link to prompting tasks; tasks link to authorizing decisions. Keep the knowledge graph navigable.
7. **GP7 — Canonical Before Custom**: Reuse existing entities and tags before adding new ones.

---

## 4. QMD Semantic Recall & Change-Contract Dependency Checks

Per `decision_adr-kb-wide-change-contracts` and `decision_adr-qmd-local-retrieval-backend`:

- **Mandatory Pre-Flight Gate**: Run `./hey deps check "<intent>"` before proposing or executing any change-intent work (e.g. `update`, `deploy`, `migrate`, `rename`, `remove`, `integrate`, `refactor`, and Korean equivalents).
- **QMD Semantic Retrieval**: QMD (`@tobilu/qmd`) provides on-device hybrid (BM25 + vector + reranking) semantic search behind `./hey search` and `./hey deps check`.
- **Degraded Recall Protocol**: If QMD is unavailable or unindexed, `deps check` falls back to structured + lexical matching and emits a stderr degraded-recall notice. Agents and engineers **MUST explicitly surface this notice** alongside results rather than presenting lexical output as complete coverage.
- **KB-Wide Change Contracts**: Any non-workspace content artifact tagged `ChangeImpact` with `x_change_contract` frontmatter binds obligations. Check and fulfill matching obligations, verification commands, and non-trigger constraints.

---

## 5. Task Status & Validation Hygiene

- **Lifecycle Transitions**: `plan → ready → [claim] → doing → done` (or `blocked`).
- **Real-Time Updates**: Update task statuses immediately at the moment of change, bumping `updated_at`. Never batch status updates to session closeout.
- **Verify Definition of Done**: Confirm every acceptance criterion before marking a task `done`.
- **Mechanical Validation Gate**: Always run `./hey validate` before committing and ensure zero errors.
