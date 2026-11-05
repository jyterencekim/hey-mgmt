---
id: decision_no-separate-kb-dir
type: decision
title: No separate knowledge-base directory
created_at: '2026-03-04'
updated_at: '2026-03-04'
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations:
  - type: supports
    target: decision_deflate-ontology
sources:
  - url: 'https://openai.com/index/harness-engineering'
    title: 'Harness engineering: leveraging Codex in an agent-first world'
  - url: 'https://github.com/anthropics/claude-code'
    title: Claude Code — agent-first repo patterns
area: Team
owner: team
---

## Context

The team considered adding a dedicated `kb/` or `knowledge/` top-level directory for project specs, protocol documentation, and design references.

## Decision

Do not add a separate knowledge-base directory. Route all project knowledge through existing paths:

| Kind | Location |
|------|----------|
| Project specs, findings, ideas | `content/notes/` |
| Runbooks, how-tos | `content/playbooks/` |
| External protocol docs | `docs/references/` |
| Decision rationale | `content/decisions/` |

## Rationale

1. **Three-layer architecture**: ARCHITECTURE.md declares three layers (content/, index/, .hey/). A fourth canonical directory adds confusion about what is source of truth.
2. **Note type is the catch-all**: The note artifact type was designed for "everything else" — specs, findings, alerts, reports, ideas. It gets frontmatter, validation, search, and cross-linking for free.
3. **Harness engineering principle**: The OpenAI Harness team uses their `docs/` directory as the knowledge store, not a separate `kb/`. Their `docs/references/` holds external SDK/API docs — we already have this.
4. **No duplication**: A separate KB directory would inevitably duplicate what `content/notes/` and `docs/references/` already provide.
5. **Progressive disclosure**: AGENTS.md serves as the table of contents. Adding a "Where to Put Knowledge" guide there provides clear routing without another directory.

## Alternatives Considered

- **`kb/` top-level directory**: Rejected — competes with `content/` as a second canonical layer.
- **`docs/specs/` subdirectory**: Rejected — project specs benefit from frontmatter validation that only `content/` provides.
- **Keep everything in `docs/references/`**: Rejected — external reference docs and team-authored specs serve different purposes.
