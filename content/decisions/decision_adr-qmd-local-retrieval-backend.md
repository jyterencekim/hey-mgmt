---
id: decision_adr-qmd-local-retrieval-backend
type: decision
title: 'ADR: Adopt qmd as the local semantic retrieval backend behind hey'
created_at: '2026-06-02'
updated_at: '2026-06-02'
decision_status: accepted
owners:
  - team
tags:
  - Engineering
  - Infrastructure
  - Operations
sources:
  - url: 'https://github.com/tobi/qmd'
    title: >-
      tobi/qmd — on-device BM25 + vector + rerank search engine (TypeScript,
      MIT)
  - ref: content/notes/2026/05/note_qmd-retrieval-benchmark.md
    title: 'QMD retrieval benchmark for this corpus (initial, small)'
  - ref: content/notes/2026/06/note_qmd-benchmark-2026-06-02.md
    title: 'QMD benchmark 2026-06-02 (149-query, all modes incl. expansion/rerank)'
  - ref: content/initiatives/2026/05/initiative_qmd-as-a-per-developer-derived.md
    title: 'Initiative: QMD as a per-developer derived retrieval backend'
  - ref: ARCHITECTURE.md
    title: Portable-core / derived-index split
area: Team
owner: team
---

## Context

`./hey search` is the team's retrieval contract. In practice it runs
**lexical-only** today: the repo shipped an OpenAI-embeddings semantic path in
April (`scripts/lib/semantic-index.mjs`, `./hey embed build`, `--retrieval
hybrid|semantic`) that is now operationally dead —

- no `OPENAI_API_KEY` is set on any machine or in `.env`;
- `.hey/semantic.sqlite` was last built **2026-04-23** and ~44% of markdown has
  changed since;
- with no key the code returns no semantic results, so `--retrieval auto`
  silently degrades to lexical (`scripts/lib/retrieval.mjs`).

That path was never ratified — it entered as a hardcoded
`text-embedding-3-large` default with no ADR. It also has two structural
problems for a small ops team: it requires distributing an API key and it
requires manual re-embedding against an external API. Neither has happened in
six weeks. The hosted-embedding path is **revealed-unmaintainable** here.

Meanwhile the lexical baseline measurably misses sentence-style queries. The
benchmark (`note_qmd-retrieval-benchmark`) hand-labeled queries and measured
the lived `./hey` behavior at **MRR 0.399** (Hit@1 4/13), strongest on exact
keywords, weakest on questions (sentence MRR 0.282).

### What qmd actually is (verified against the repo)

[tobi/qmd](https://github.com/tobi/qmd) is an **on-device** search engine:

- **TypeScript / Node ≥22** (we run 23.7), installed via `npm install -g
  @tobilu/qmd` or used as a library `@tobilu/qmd`. MIT, ~26k★, active
  (v2.5.3, May 2026). It fits our Node toolchain — it is **not** a foreign
  native runtime.
- **Fully local, no API, no key.** Models are GGUF, auto-downloaded once to
  `~/.cache/qmd/models/` (machine-global, shared across repos).
- Modes: `search` (BM25), `vsearch` (vector), `query` (hybrid RRF). Storage is
  SQLite (FTS5 + sqlite-vec).
- Models and sizes: embedding `embeddinggemma-300M-Q8_0` (~300 MB); reranker
  `qwen3-reranker-0.6b-q8_0` (~640 MB); query-expansion
  `qmd-query-expansion-1.7B-q4_k_m` (~1.1 GB).
- macOS prerequisite: `brew install sqlite`.

### Benchmark evidence (2026-06-02)

A 149-query labeled set (99 keyword + 50 natural-language question) over the
full **1,476-file / 4,116-chunk** corpus (one-time embed: **144 s**), measured
2026-06-02 (full log: `note_qmd-benchmark-2026-06-02`):

| Mode | MRR all | MRR keyword | MRR question | latency/query |
| --- | ---: | ---: | ---: | ---: |
| **qmd hybrid** (BM25+vector, RRF) | **0.714** | 0.812 | **0.520** | ~25 ms |
| lexical (today's `hey`) | 0.521 | 0.663 | 0.239 | 493 ms |
| qmd BM25 only | 0.594 | **0.884** | 0.020 | 2 ms |
| qmd vector only | 0.542 | 0.551 | 0.524 | 25 ms |

**Hybrid is the best single default**: strong on both classes where each pure
mode has a fatal weakness (BM25 collapses on questions, 0.020; vector is
mediocre on keywords). Versus today's lexical it roughly **doubles
question-MRR** (0.520 vs 0.239) and improves keyword (0.812 vs 0.663), at ~20×
lower latency.

**Expansion and rerank were measured and are worse — not just slower.** They are
query-time LLM steps (1.7 B expansion, 0.6 B reranker) that run on *every* query:

| Mode | MRR all | keyword | question | latency/query |
| --- | ---: | ---: | ---: | ---: |
| qmd hybrid (chosen) | **0.714** | **0.812** | **0.520** | ~25 ms |
| + expansion | 0.662 | 0.755 | 0.478 | 2.0 s |
| + expansion + rerank | 0.658 | 0.743 | 0.491 | 8.8 s |

They **lose to plain hybrid on every metric** while costing 80–350× more. So
they are **dropped entirely** — not even an opt-in `--deep`. Only the ~318 MB
embedding model is downloaded; the reranker (640 MB) and expansion (1.1 GB)
models are never fetched.

## Decision

**Adopt qmd as the local semantic retrieval backend behind the `hey`
contract.** qmd becomes *the* semantic provider for this repo; the existing
lexical path is the documented fallback. The undocumented OpenAI-embeddings
path is **retired** (see Consequences).

`hey` remains the source of truth for artifact semantics, validation,
frontmatter, IDs, and commands. qmd is a **read-only, derived** layer.

### Locked architecture

- **Source of truth: unchanged.** Markdown + frontmatter + git. qmd reads
  only; it never writes the corpus, never edits frontmatter, never mints IDs —
  it returns IDs and paths that already exist.
- **Provider:** qmd as a library (`@tobilu/qmd`) via the SDK. The adapter calls
  `searchLex` (BM25) + `searchVector` (vector) and fuses them with **RRF
  itself** — it does **not** call `store.search()`, whose full pipeline triggers
  query expansion.
- **Models:** embedding `embeddinggemma-300M-Q8_0` only, pinned via
  `QMD_EMBED_MODEL`. **No reranker, no query-expansion** — only ~318 MB, in the
  machine-global `~/.cache/qmd/models/` cache (shared across repos).
- **Default mode:** hybrid (BM25 + local vector, RRF-fused). Embedding-only; no
  query-time LLM.
- **Install location:** qmd is installed per-developer into **`.hey/qmd/runtime/`**
  (gitignored) — *not* the repo `package.json`. This keeps the base `pnpm
  install` light for people who don't use qmd, sidesteps the repo's dual-lockfile
  situation, and makes non-interference automatic. The index lives at
  `.hey/qmd/index.sqlite` (gitignored). Model weights live in `~/.cache/qmd/` —
  outside the repo entirely, so no qmd weights ever enter the tree.
- **Corpus:** artifacts only — `content/`, `docs/`, and workspace artifacts,
  **excluding** `workspace/**/logs/**` and `**/inbox/**` (non-artifacts per
  `ARCHITECTURE.md`). qmd results are additionally post-filtered against the
  manifest so a non-artifact can never surface.
- **Chunk→artifact mapping:** qmd returns chunk hits. The adapter resolves each
  to a canonical artifact id by parsing frontmatter `id` from the chunk body
  (fallback: reconstruct from `displayPath`, restoring the type-prefix `_` that
  qmd renders as `-`), dedups multiple chunks to one result per id, applies the
  same `--type/--status/--owner/--area` filters as lexical, and returns the
  manifest item shape callers already expect.
- **Adapter:** auto-detect (see Integration). On **any** failure (qmd not
  installed, index missing, model load fail, timeout, hyphen-token reject) it
  falls back silently to lexical for callers, logging the failure to stderr so
  it stays diagnosable.
- **Install command:** `./hey index build --qmd` preflights (Node ≥22,
  `sqlite3` / `brew install sqlite` on macOS, free disk, network), installs qmd
  into `.hey/qmd/runtime/` on first run (prints download size + estimate), then
  builds/refreshes the index — rebuilt alongside the lexical index.
- **Scope of rollout:** the engineering machines that actually run `./hey`
  (terence, jared, oliver, eb) plus the Fisher host. The ~28 names in
  `members.yml` are mostly external partners who never run the CLI; this is not
  a 28-machine install.
- **Off-device agents** (cloud, CI) are out of scope; revisit hosting only if
  that changes.

### Integration (skills & workflows)

`./hey search` **auto-uses qmd when available** — no skill or command changes:

- **Non-empty query** with qmd installed → qmd hybrid. A **stale index is
  refreshed in place first** (incremental, ~2–5 s) — qmd is prioritized over a
  fast-but-worse lexical result, because this repo updates frequently and the
  semantic win is large. Lexical only when qmd isn't installed or a build/query
  errors. (Freshness is checked against the whole indexed corpus — content,
  docs, workspace artifacts, and the Fisher knowledge `.jsonl`.)
- **Empty-query listings** (`./hey search "" --type task --status ready`, used
  by `/morning`, `/standup`, `/check`, the iteration commands, etc.) are
  deterministic filters and **always** use lexical — qmd is never invoked.
- Net: only real-query consumers (`/search`, `/decide`, agent context
  retrieval) benefit; everything else is byte-identical. Machines without qmd
  behave exactly as today.

The presence of the `.hey/qmd/` index — built by a deliberate `./hey index
build --qmd` — is the per-machine **opt-in signal**. `--backend lexical|qmd`
remains an explicit override for debugging.

### Non-interference invariants (load-bearing; part of DoD)

Per `ARCHITECTURE.md`'s portable-core / derived-index split:

- Nothing qmd-related is committed. `.hey/qmd/` is gitignored; model weights
  live in `~/.cache/qmd/`, outside the repo entirely.
- `./hey search` without `--backend`, `./hey validate`, `./hey index build`
  (lexical), and `./hey db build` MUST work identically with qmd absent.
- CI MUST NOT require qmd.
- Removing `.hey/qmd/` and uninstalling qmd MUST leave the repo functionally
  identical to today. Verified by an explicit smoke test.

## Alternatives considered

- **Revive the OpenAI semantic path.** Rejected. It needs key distribution +
  manual re-embedding against an external API; the team has supplied neither
  for six weeks. Reviving something already shown to decay is the weakest
  option. It also ships repo content (financial ops, incidents, member data)
  to an external API on every build/query — local embeddings avoid that.
- **qmd as a third backend *alongside* OpenAI semantic.** Rejected. Two
  embedding stacks, two staleness problems, two failure surfaces for a 4–5
  engineer team. One semantic provider is the right altitude.
- **Do nothing (lexical-only forever).** Rejected. Leaves the measured
  sentence-query gap unaddressed when a local, no-key fix is available.
- **Enable qmd reranker / query-expansion (even as opt-in).** Rejected —
  **measured worse**, not just slower. On the 149-query set they lose to plain
  hybrid on every metric (all-MRR 0.662/0.658 vs 0.714) while costing ~2 s/~9 s
  per query vs ~25 ms. Dropped entirely; their 640 MB / 1.1 GB models are never
  downloaded. See `note_qmd-benchmark-2026-06-02`.

## Consequences

### Retire the OpenAI-embeddings path *(done 2026-06-02)*

The dead path was removed in full when this ADR landed (search is now
lexical-only until the qmd adapter ships):

- Deleted `scripts/lib/semantic-index.mjs` (OpenAI embedding build/search) and
  `scripts/lib/__tests__/semantic-index.test.mjs`.
- Removed the `embed build` / `embed hygiene` commands, the `--retrieval` flag,
  and the OpenAI imports from `scripts/hey.mjs`.
- Collapsed `searchRepositoryAdaptive` (`scripts/lib/retrieval.mjs`) and
  `searchKnowledgeAdaptive` (`scripts/lib/knowledge-search.mjs`) to lexical-only
  async entry points; the qmd backend will reattach there. `fuseHybridRanks`
  and the hybrid-score helpers were deleted rather than kept dormant — the qmd
  adapter reintroduces fusion (RRF) when it lands (`git` history preserves the
  prior implementation).
- Corrected the docs that pointed at the dead path (`docs/OPERATING_GUIDE.md`,
  `docs/WORKFLOW_GUIDE.md`).
- Removed the stale local `.hey/semantic.sqlite` (gitignored derived state).

Verified: full test suite (215/215), `./hey search` (lexical + `--include-knowledge`)
and `./hey validate` pass; `--retrieval` and `embed` are gone.

**Out of scope / explicitly kept** — these are unrelated to embeddings:
`hermes-client.mjs` `HERMES_BACKEND_MODEL` (the active LLM classifier
backend), the `llm_semantic_match` policy label, and business uses of the word
"semantics".

### Positive

- Good retrieval becomes the **default**, not a config accident — no key, no
  network, rebuilt by the `./hey index build` habit people already keep.
- Repo content stays on-device.
- ~100× faster warm search; sentence queries materially improved.

### Costs / risks

| Risk | Mitigation |
| --- | --- |
| Adapter couples core to qmd | Non-interference DoD + "uninstall + remove `.hey/qmd/`" smoke test |
| Index staleness | `./hey index build --qmd` rebuilds qmd alongside lexical; manual rebuild documented |
| GGUF model drift | Pinned embedding model; manual upgrade only |
| Hyphenated tokens (`2-hop`) reject in vector path | Adapter sanitizes before forwarding |
| Parallel ingest SQLite locking (seen in benchmark) | Ingest/refresh collections serially |
| Fisher-knowledge granularity | Row-level JSONL chunker before Fisher adds the collection |
| `brew install sqlite` missing on macOS | Install hook checks and documents it |

## Plan

Tracked under `initiative_qmd-as-a-per-developer-derived`:

1. **This ADR** — locks architecture, defaults, fallback, model pinning,
   non-interference. *(done)*
2. **Adapter + per-dev install hook** — `./hey index build --qmd` (preflight +
   install into `.hey/qmd/runtime/` + build), and the auto-detect hybrid adapter
   in `searchRepositoryAdaptive` / `searchKnowledgeAdaptive` with frontmatter-id
   mapping and silent lexical fallback. `--backend lexical|qmd` as debug override.
3. **Benchmark harness** — promote the 149-query labeled set + runner into
   `scripts/` (committed) so results are reproducible.
4. **fisher-jsonl chunker** — row-level chunks.
5. **Fisher host install** — scripted, models pre-pulled (no auto-pull mid-run).
6. **Cutover** — qmd is auto-on wherever the `.hey/qmd/` index exists (opt-in is
   building it). Expansion/rerank dropped (measured worse — `note_qmd-benchmark-2026-06-02`).
