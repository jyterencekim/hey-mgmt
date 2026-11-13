---
name: shared-libs
description: Discover, reuse, or extract cross-repo shared code modules and snippets via the team's `role: shared-libraries` repository (`INDEX.md` -> `catalog/` -> `<lang>/`). Trigger BEFORE implementing cross-cutting utilities (RPC/HTTP clients, fallbacks/retries/circuit breakers, number/decimal/currency/timezone formatting, protocol codecs, auth helpers) or when extracting duplicated logic across repositories.
---

# Shared Libraries Discovery, Reuse & Extraction

Keep `mgmt` free of per-module catalogs and code snippets. All capability cards, snippets, modules, and shared test vectors live in the repository marked `role: shared-libraries` in `content/vocab/repos.yml`.

## 1. Locate the `shared-libraries` Repository

1. Inspect `content/vocab/repos.yml` for `role: shared-libraries` (or run `./hey repos list` / `./hey repos resolve "<intent>"`).
2. Resolve its local checkout via `workspace/$MEMBER/repos.yml` first, then sibling `../<local_dir|name>`.
3. If the local directory is missing, stop and tell the user to clone the remote from `repos.yml` before re-implementing shared logic from scratch.

## 2. 3-Hop Fuzzy Discovery (Before Writing Code)

1. **Hop 1 — Read `INDEX.md` in full:** Read `<libs-repo>/INDEX.md` (single-page semantic router with no code blocks). Match your task's intent, failure modes, and invariants against the listed capabilities.
2. **Hop 2 — Open matched `catalog/<domain>/<slug>.md` card(s):** Read ONLY the 1–2 matched cards. Verify **Invariants** and **Do NOT Use When** before adopting. If two sibling capabilities look similar (e.g. head-read fallback vs pinned-block read, or `HALF-UP` display vs truncating `BigInt` ledger math), pick the exact matching contract.
3. **Hop 3 — Read `<lang>/<module>/` and `specs/<slug>/vectors.json`:**
   - If `status: extracted`, inspect the language implementation and tests.
   - If `status: in-situ`, inspect the canonical source repo referenced on the card (`mode: read-only` unless that repo is in scope for changes) and either reuse/vendor from it or extract it into `<libs-repo>` first.

## 3. Consumption Modes (`import` vs `vendor`)

- **`import`:** Use native tooling (`go get`, `uv` git dependency, or workspace/registry package) when the consumer repo allows external/git imports from the libs repo.
- **`vendor` (zero-friction across orgs or zero-dep services):** Copy the zero-dependency module file (and its unit test if applicable) into the consumer repo with a provenance header on line 1:
  `// @shared-lib: <slug>@<short-commit-or-tag>`
  Do not silently fork vendored logic; fix bugs upstream in `<libs-repo>` and re-sync the stamp.

## 4. Extracting or Registering a Capability

When extracting duplicated logic into `<libs-repo>` (or registering a new `in-situ` canonical source):

1. Check `INDEX.md` first so you extend an existing capability instead of duplicating it.
2. Separate conflicting invariants into distinct cards/modules rather than merging them behind boolean flags.
3. Strip `process.env`, secret managers, and framework DI from core functions.
4. Add or update `specs/<slug>/vectors.json` and run all language test suites plus catalog validation inside `<libs-repo>` (update only `INDEX.md` and `catalog/` in `<libs-repo>`, never duplicating module entries into `mgmt`).
