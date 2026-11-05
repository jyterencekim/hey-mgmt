# qmd on the Fisher host — ops note

Operational notes for running the qmd local semantic search backend on Fisher,
the headless agent host. Authoritative design:
[`decision_adr-qmd-local-retrieval-backend`](../../content/decisions/decision_adr-qmd-local-retrieval-backend.md).

## What qmd is here

qmd is a per-developer, opt-in **local** retrieval backend behind `./hey search`.
It runs embedding-only **hybrid** search (BM25 + vector, fused with Reciprocal
Rank Fusion). There is no reranker and no query-expansion — both were
benchmarked worse and 80–350x slower, so they are dropped entirely and their
larger models are never downloaded.

Everything is on-device: no API key, no network at query time. The markdown +
frontmatter corpus stays the source of truth; qmd is a read-only derived layer.

## Install path and storage

- **Runtime:** `.hey/qmd/runtime/` (gitignored) — qmd is installed here, not in
  the repo `package.json`. Nothing qmd-related is committed.
- **Index:** `.hey/qmd/index.sqlite` (gitignored) — derived, rebuilt locally.
- **Model cache:** `~/.cache/qmd/` (machine-global, shared across repos). Only
  the ~318MB embedding model lands here; it downloads on the first index build.

## How Fisher's agent flows benefit

Fisher's flows already call `./hey search "<query>"`. Once a fresh qmd index
exists, `./hey search` **auto-detects** it and uses hybrid retrieval — no flow
or command changes. This materially improves sentence/question-style queries
(the kind agents issue) while keeping exact-keyword search strong, at ~25ms warm
latency. The `--backend auto|lexical|qmd` flag stays available for debugging.

Empty-query listings (deterministic filters used by `/morning`, `/standup`,
etc.) always use lexical and never invoke qmd.

## Provisioning and rebuild cadence

Provision (and refresh) with the idempotent script:

```bash
bash workspace/fisher/scripts/provision-qmd.sh
```

It preflights (Node >= 22, sqlite3 present), then runs `./hey index build --qmd`
to install the runtime and build/refresh the index. The first run downloads the
embedding model to `~/.cache/qmd`; later runs reuse it.

**Cadence:** re-run after every repo pull, aligned with Fisher's repo-pull
cadence. The index is stale once markdown changes after it was built; auto-detect
falls back to lexical when the index is stale or absent, but re-provisioning
keeps Fisher on hybrid retrieval. Provisioning is done **ahead of agent runs** so
Fisher never has to download a model mid-flow (it cannot answer prompts and must
not auto-pull large models during a run).

## Non-interference guarantee

With qmd absent or stale, the repo behaves identically: `./hey search` (no
`--backend`), `./hey validate`, `./hey index build`, and `./hey db build` all
work the same as without qmd. qmd is always lazily/dynamically imported, and CI
never requires it.

## Uninstall

```bash
rm -rf .hey/qmd/
```

This removes the runtime and index. The repo is then functionally identical to a
host that never had qmd. To also reclaim the model cache, remove `~/.cache/qmd/`
(machine-global — only do this if no other repo on the host uses qmd).
