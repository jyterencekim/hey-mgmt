---
id: playbook_shared-libraries
type: playbook
title: "Shared Libraries: LLM-Routed Cross-Repo Index and Extraction"
created_at: 2026-11-13
updated_at: 2026-11-13
playbook_version: "1.0.0"
owner: team
area: Infra
status: active
tags:
  - Engineering
  - Infrastructure
  - Documentation
relations:
  - type: supports
    target: playbook_operating-philosophy
  - type: supports
    target: playbook_golden-principles
sources:
  - kind: doc
    ref: ARCHITECTURE.md
    title: "Portable core — prefer Markdown contracts over bespoke services"
  - kind: doc
    ref: content/vocab/repos.yml
    title: "Repository registry and shared-libraries role"
---

# Shared Libraries: LLM-Routed Cross-Repo Index and Extraction

## Architecture Boundary

`mgmt` stores ONLY the `role: shared-libraries` repository pointer and situational routing entry in `content/vocab/repos.yml`. All capability descriptions, language mappings, code snippets, source implementations, and shared test vectors live inside the `<org>-libs` repository (`entrypoints: [INDEX.md, AGENTS.md]`).

This keeps module additions and refactors inside a single PR in the libraries repository with zero dual-repo synchronization overhead.

## Why LLM Fuzzy Matching (No Bespoke CLI)

Choosing whether an existing utility fits a task depends on behavioral invariants (for example: pinned-block read consistency vs head-read fallback, `HALF-UP` wallet display vs truncating `BigInt` ledger math, or transport-only retry boundaries). Lexical CLI matching misses intent or conflates incompatible contracts. Agents read `../<libs-repo>/INDEX.md` directly and match by semantics.

## 3-Hop Progressive Disclosure inside `<org>-libs`

1. **Hop 1 — `INDEX.md` (Single-page semantic router):**
   - Groups capabilities by domain (`rpc`, `number`, `time`, `codecs`, etc.).
   - Keeps each entry to 1–2 lines: problem/intent summary, supported languages, `extracted` or `in-situ` status, and link to `catalog/<domain>/<slug>.md`.
   - MUST NOT contain code blocks so the full router fits in one `read_file` call even past 100 entries.
2. **Hop 2 — `catalog/<domain>/<slug>.md` (Capability card):**
   - Opened only for the 1–2 matches selected from `INDEX.md`.
   - States **Purpose**, **Invariants**, explicit **Do NOT Use When** boundaries, per-language code snippets (`ts`, `go`, `py`, `solidity`), source/test paths, and consumption mode (`import` vs `vendor`).
3. **Hop 3 — `<lang>/<module>/` + `specs/<slug>/vectors.json` (Source & polyglot test vectors):**
   - Holds environment-decoupled pure modules, unit tests, and language-neutral `vectors.json` golden cases verified across every supported language port.

## Two-Stage Extraction Lifecycle (`in-situ` -> `extracted`)

- **`in-situ`:** Before a helper is extracted into `<org>-libs`, record a capability card pointing to the single best canonical implementation in an existing repo so new work reuses that pattern instead of creating another variant.
- **`extracted`:** Promote a capability into `<org>-libs` once 2+ repos need it or a bug fix proves divergent copies are drifting:
  1. **Compare before merging:** Build a behavior matrix of existing copies. If invariants conflict, publish separate modules rather than one option-flag soup.
  2. **Strip environment coupling:** Remove `process.env`, secret-manager clients, framework DI, and UI components; inject configuration and transports as pure arguments.
  3. **Write shared `vectors.json`:** Lock edge cases (rounding, error taxonomy, boundary inputs) in `specs/<slug>/vectors.json` and test every language implementation against it.
  4. **Consume cleanly:** Use native package/git `import` when org/dependency rules allow, or copy zero-dependency single-file modules (`vendor`) with a header stamp (`// @shared-lib: <slug>@<commit>`) for provenance and upgrades.
