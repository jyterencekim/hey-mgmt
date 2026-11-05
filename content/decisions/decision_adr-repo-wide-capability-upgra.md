---
id: decision_adr-repo-wide-capability-upgra
type: decision
title: 'ADR: Repo-wide capability upgrade command (desired-state, not migrations)'
created_at: '2026-06-08'
updated_at: '2026-06-08'
area: Team
owner: team
owners:
  - team
status: active
decision_status: accepted
tags:
  - Engineering
  - Infrastructure
  - Operations
sources:
  - ref: content/decisions/decision_adr-qmd-local-retrieval-backend.md
    title: 'ADR: qmd local retrieval backend — the motivating optional capability'
  - ref: scripts/lib/capabilities.mjs
    title: Capability registry implementing this decision
  - ref: .claude/commands/upgrade.md
    title: /upgrade skill — member-facing entry point
---

## Context

A checkout of this repo needs several capabilities to be fully functional: Node
dependencies, shared git hooks (`core.hooksPath=.githooks`), the derived index +
catalog DB, and — newly — optional local semantic search (qmd, see
[`decision_adr-qmd-local-retrieval-backend`](decision_adr-qmd-local-retrieval-backend.md)).

`/setup` covers first-clone onboarding, but it is interactive and run-once
(member identity, language, profile scaffolding). There was no convenient,
re-runnable way to (a) verify a checkout is up to spec or (b) adopt a capability
that shipped *after* a member onboarded. qmd is the motivating case: it is
opt-in and per-developer, and enabling it required knowing to run `./hey index
build --qmd` — so members never discovered it.

## Decision

Introduce **`./hey upgrade`** (and a thin `/upgrade` skill) — a repo-wide command
that brings a checkout up to spec, idempotently, safe to re-run anytime.

- Capabilities are declared in a registry, `scripts/lib/capabilities.mjs`. Each
  entry: `{ id, title, version, kind, check(repoRoot), apply(repoRoot,{log}) }`.
- The model is **desired-state, not a migration ledger**: every run reads machine
  state via `check()` and applies whatever is missing. There is no recorded
  "current version" that gates execution.
- `kind` controls behavior: `core` is auto-applied; `optional` is **prompted**
  before applying (preserving opt-in for expensive features); `diagnostic` is
  reported but never auto-fixed (it needs interactive `/setup`).
- Version numbers are human-facing changelog labels (`./hey upgrade --changelog`),
  not run-once gates.
- It **complements** `/setup` (unchanged); it does not replace it.

## Alternatives considered

- **Versioned migration ledger** — numbered steps run once, recorded in
  `.hey/`. Rejected: developer environments are not monotonic. Clearing
  `~/.cache/qmd` or deleting `.hey/` would leave the ledger claiming a feature is
  installed while it is gone. Desired-state self-heals; a ledger cannot.
- **Fold everything into `/setup`.** Rejected: setup has interactive, run-once
  concerns (member identity) that are not idempotent capabilities. Conflating the
  two muddies both; keep onboarding and capability-maintenance separate.
- **Auto-install optional features.** Rejected for expensive ones (qmd: ~318MB
  model + Homebrew sqlite + native build): silent installs surprise members.
  Prompt instead; default to skip without a TTY.

## Consequences

- New members: `/setup`, then `/upgrade`. Existing members: `/upgrade` anytime to
  adopt newly-shipped capabilities.
- Adding a capability is appending one registry entry (plus bumping
  `CAPABILITIES_VERSION` and `CHANGELOG`) — no new command, no migration
  bookkeeping.
- Per-developer capability state stays in the gitignored `.hey/`; nothing about a
  member's local state is committed.
- The agent-run `/upgrade` skill prompts conversationally (agent Bash has no TTY);
  `--with-optional` and `--yes` cover non-interactive use.

## Tooling versioning & currency

Two layers upgrade differently, and the registry reflects both:

- **Machine-side capabilities** (qmd runtime, deps, index, hooks-config) need
  install/build — that is what `apply()` is for.
- **Repo-versioned assets** — the `hey` CLI code, the Claude skills/commands in
  `.claude/commands/`, and the hooks — arrive via `git pull`; there is no install.

So the tooling carries an explicit version, separate from `CAPABILITIES_VERSION`
(which versions the registry itself):

- `package.json` `version` — the **hey CLI** version (also what `hey --version`
  reports; single source of truth).
- `package.json` `skillsVersion` — the **Claude skills/commands** version.

The `tooling-current` diagnostic compares both against `origin/main` and nudges a
`git pull` when the checkout is behind — answering "am I running the latest
commands and CLI?" on the same surface as the machine checks. It stays a
diagnostic (never auto-pulls), because a pull can collide with local work. Bump
`version` / `skillsVersion` when the respective part changes.

## How to add a capability

1. Append `{ id, title, version, kind, check, apply }` to `CAPABILITIES` in
   `scripts/lib/capabilities.mjs`.
2. `check(repoRoot)` reads machine state and returns `{ ok, detail }`.
   `apply(repoRoot, { log })` makes it true — idempotent, may be async, may throw.
3. Use `kind: 'optional'` with a `prompt` for anything expensive; `kind:
   'diagnostic'` with a `hint` for interactive fixes.
4. Bump `CAPABILITIES_VERSION` and add a `CHANGELOG` entry.

Refs: [`decision_adr-qmd-local-retrieval-backend`](decision_adr-qmd-local-retrieval-backend.md),
`scripts/lib/capabilities.mjs`, `.claude/commands/upgrade.md`.
