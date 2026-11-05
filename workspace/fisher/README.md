# Fisher's Workspace

Runtime workspace for **fisher**, the always-on team operations agent on the Mac Mini.

## Authoritative Runtime

Fisher runs on **Hermes** on the office Mac Mini:

- Hermes owns DMs and allowlisted-channel mentions
- the repo-scoped Fisher agent is `hey-mgmt`
- Hermes owns scheduled activity polling, classification, and reflection-based finalization
- Activity uses a **three-tier model**: raw events → observations → team knowledge (see [ARCHITECTURE.md](./ARCHITECTURE.md))

All legacy runtime code has been removed. Only collector libraries and config remain in `external-activity-runtime/lib/`.

## Runtime Surface

- [`external-activity-runtime/`](./external-activity-runtime/): collector libraries and config loader
- [`config/external-activity.yml`](./config/external-activity.yml): collector/member config plus the declared Hermes ownership contract
- [`skills/hey-mgmt-activity/SKILL.md`](./skills/hey-mgmt-activity/SKILL.md): scheduled activity pipeline instructions for Hermes
- [`skills/hey-mgmt-slack-agent/SKILL.md`](./skills/hey-mgmt-slack-agent/SKILL.md): conversational Slack contract for the repo-scoped Fisher agent

## Required Operator State

Hermes on the office Mac Mini must own:

- Slack ingress for DMs plus the allowlisted team channels
- the repo-scoped `hey-mgmt` Fisher workspace at `/Users/hey-mgmt/workspace/hey-mgmt`
- scheduled activity jobs listed under `hermes.cron_jobs` in [`config/external-activity.yml`](./config/external-activity.yml)
- runtime secrets in `~/.hermes/.env`; repo-local `.env` files are for direct shell dry-runs

Digest and moderation delivery SHOULD use the button-based digest flow, not per-candidate approval polling.

## Knowledge Base

Fisher automatically captures external context from every poll cycle into a searchable knowledge index. No additional background processes are needed — knowledge capture piggybacks on the existing Hermes scheduled pipeline.

### How it works

The pipeline uses a two-pass AI gate (classify + reflect):

```
Hermes scheduler triggers (every 10 min per source in the current setup):
  1. hey activity poll <source>              ← polls Slack/Confluence/Drive
  2. hey activity prepare-candidates         ← reads recent events, searches artifacts
  3. Agent classifies + reflects             ← match/distill/skip + promote/observe/filter
  4. hey activity finalize-reflections       ← writes observations + auto-promotes
  5. gitCommitAndPush                        ← commits observations/ and knowledge/
```

In step 4, `finalizeReflectionDecisions()` routes each decision through the reflection gate:
- **filter** (skip or low confidence) → knowledge entry as `"indexed"` only
- **observe** (moderate confidence) → observation file + knowledge entry as `"indexed"`
- **promote** (high confidence) → observation file + content artifact updated + knowledge entry as `"linked"`

Twice daily (12:00, 18:00 KST), a batched digest is posted to `#hey-mgmt-internal` with reject/revoke/delete buttons. No per-candidate approval DMs and no full-id text reply requirement.

### Storage

| Layer | Path | Git-tracked | Purpose |
|-------|------|-------------|---------|
| Observations | `workspace/fisher/observations/YYYY-MM-DD.md` | Yes | Daily staging area. Human-browsable, deletable. |
| Durable index | `workspace/fisher/knowledge/YYYY-MM.jsonl` | Yes | Append-only pointer entries. Written after reflection only when source, object id, title, date, and signature are present. |
| Search cache | `.hey/catalog.sqlite` `knowledge` table | No | Rebuilt by `./hey db build`; readers apply logical upsert by signature, and `./hey search --include-knowledge` rebuilds when tracked knowledge is newer. |

Each pointer entry contains: source, title, summary (raw, never agent-generated), URL, actors, workspace_owner, date, classification, status, relevance_score, signature. No raw message content — just enough to locate the original.

Expected volume: ~4000 entries/month (~800 KB/month) across 4 Slack channels + Confluence/Drive.

### Compaction

Normal pipeline writes are append-only to reduce Git conflicts between frequent agents. Git uses union merge for `workspace/fisher/knowledge/*.jsonl`, so concurrent appended rows are retained during rebase instead of forcing one side to overwrite the other. Search and status readers deduplicate logically. If the durable files need physical cleanup, run compaction from a single owner context after pulling latest `main`:

```bash
./hey activity compact-knowledge
./hey db build
```

Fisher also has a scheduled compaction check:

```bash
./hey activity auto-compact-knowledge
```

Hermes runs it daily at 03:15 KST. The command pulls latest `main`, measures raw rows versus logical rows, and only rewrites JSONL when the policy thresholds in `content/policies/external-activity.yml` are met. By default it waits at least 24 hours between compactions and compacts when either 500+ superseded rows at 20%+ garbage are present, or a weekly periodic check sees 50+ superseded rows.

### Search (any team member)

```bash
# English search
./hey search "vault rebalancing" --include-knowledge

# Korean search (CJK-aware tokenization — 2-char Hangul tokens supported)
./hey search "볼트 리밸런싱" --include-knowledge

# Scoped to one member
./hey search "strategy config" --include-knowledge --knowledge-owner alice

# All members
./hey search "strategy config" --include-knowledge --knowledge-owner "*"

# Direct SQL
./hey db query "SELECT title, url, date FROM knowledge WHERE source='slack' ORDER BY date DESC LIMIT 10"
```

### Search via Slack (through Hermes/Fisher)

Fisher's tool registry now includes `search_knowledge`:
- Ask Fisher on Slack: *"what did the team discuss about vault rebalancing last week?"*
- The agent can use `search_knowledge` to query the knowledge base alongside `search_repo` for artifacts
- `compile_context` also surfaces relevant knowledge entries in its `knowledge_context` output

Retrieval-style Slack questions MUST follow
[`playbook_retrieval-protocol`](../../content/playbooks/playbook_retrieval-protocol.md).
That means Fisher should keep at least a small candidate set, expand the
user's wording, disconfirm the top candidate, and include a short visible proof.

Expected answer shape:

```text
Retrieval proof: checked 5 candidates across content/tasks, content/notes, git log, and Fisher knowledge; disconfirmed the LINE NEXT-only path with D14/5M searches.
Winner: task_add-alm-liquidity-gates-and-wi because it contains D14 gate plus default 5M USDT same-day cap.
```

### Verifying knowledge capture is working

```bash
# Check for knowledge entries (after a few poll cycles)
ls workspace/fisher/knowledge/
wc -l workspace/fisher/knowledge/2026-04.jsonl

# Rebuild search cache and query
./hey db build
./hey db query "SELECT count(*) FROM knowledge"
./hey db query "SELECT classification, count(*) as cnt FROM knowledge GROUP BY classification"
```

### Relevance scoring

Each entry carries a `relevance_score` that controls search ranking:
- High-confidence skip → low relevance (filtered out by default threshold 0.15)
- Match/distill → relevance proportional to agent confidence
- Linked (auto-promoted) entries → boosted relevance (1.2x)
- Revoked entries → boost removed, demoted to observation tier

Search results multiply knowledge scores by 0.8 when merged with artifact results, so canonical artifacts rank higher than external context pointers.

### Status and health

```bash
./hey activity status           # human-readable pipeline health
./hey activity status --json    # structured JSON
./hey activity post-status      # post to #hey-mgmt-internal
```

Or DM Fisher on Slack: `status`, `health`, or `diagnose`.

## Runtime Host

Fisher runs on Hermes on the office Mac Mini, not on local developer laptops.
This repo documents and tests the Fisher runtime, but live Slack/Hermes checks
and Auditor env wiring must be performed on that Mac Mini.

## Auditor Deployment Shares

Fisher can deliver material Slack deployment-share messages to the
hey-mgmt-auditor source-journal gateway:

```bash
./hey activity deliver-deployment-shares --dry-run
./hey activity deliver-deployment-shares --gateway-url "$AUDITOR_COLLECT_URL"
```

The command reads recent Slack rows from `.hey/external-activity/events.jsonl`,
filters to configured deployment channels, and posts deterministic
`hey-mgmt.ops_deployment_share@1` entries to:

```text
POST /audit-collect/v1/sources/fisher_slack_deployment/operations/{operationId}/batches
```

Slack remains evidence and publication context. Fisher does not write canonical
Auditor rows; the Auditor `opsdeploymentsharev1` translator maps the source
entries conservatively.

## Auditor Protocol Knowledge Publisher

Fisher's protocol-knowledge path has two separate stages:

1. Hermes/Fisher AI reads Fisher knowledge, repo context, and allowed source
   excerpts, then writes a formalized package containing `source_records`,
   optional `draft_nodes`, and `draft_claims`.
2. The publisher below mechanically validates and posts that package to
   Auditor. It MUST NOT infer predicates, subjects, objects, validity windows,
   or evidence by itself.

```bash
node workspace/fisher/external-activity-runtime/protocol-knowledge-publisher.mjs \
  --package workspace/fisher/.runtime/protocol-knowledge/formalized-package.json \
  --dry-run

node workspace/fisher/external-activity-runtime/protocol-knowledge-publisher.mjs \
  --package workspace/fisher/.runtime/protocol-knowledge/formalized-package.json
```

The package is posted to:

```text
POST /api/observatory/protocol-knowledge/ingest
```

Use `AUDITOR_COLLECT_URL` and `AUDITOR_COLLECT_TOKEN`; the endpoint requires
Auditor `source:write`. Auditor stores the package as source records and draft
claims, then applies its own promotion gate when the package requests
`promote.apply=true`. Source-asserted promotions remain context facts, not
verifier-confirmed hard facts.

## Auditor Trace Publication Summaries

When Fisher posts or previews an Auditor operation trace, it should use the
structured `publicationReceipts[]` field from:

```text
GET /api/auditor/traces/{operationId}
```

Run:

```bash
node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --operation-id op_...
node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --operation-id op_... --channel CDEPLOY
```

The command renders durable publication receipts first. If the trace has no
`publicationReceipts[]`, Fisher may show legacy evidence-fact permalinks as
fallback context, but it must label the operation as missing a publication
receipt instead of treating the permalink as the completed `shared` stage.

When the command posts to Slack with `--channel`, it also writes a
`publication_receipt` source entry to the Auditor collect gateway using
`AUDITOR_COLLECT_URL` and `AUDITOR_COLLECT_TOKEN`. This makes Fisher's own
trace-summary post durable immediately instead of waiting for a later Slack
collector pass to rediscover it.

## Auditor Launch Wiring on the Mac Mini

When Auditor/Observatory becomes live, launch Fisher wiring from the Mac Mini:

1. Pull the latest `main` in the Mac Mini checkout at
   `/Users/hey-mgmt/workspace/hey-mgmt`.
2. Add the live endpoints and tokens to Hermes runtime env
   `~/.hermes/.env`:
   `AUDITOR_API_URL`, `AUDITOR_READ_TOKEN`, `AUDITOR_COLLECT_URL`, and
   `AUDITOR_COLLECT_TOKEN`. Use
   `workspace/fisher/external-activity-runtime/.env` only for direct shell
   dry-runs.
3. Run a source delivery dry run:
   `./hey activity deliver-deployment-shares --dry-run`.
4. Run an Auditor trace summary dry run against a known operation id:
   `node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --operation-id op_... --dry-run`.
5. Run a protocol-knowledge package dry run with a Hermes-generated fixture:
   `node workspace/fisher/external-activity-runtime/protocol-knowledge-publisher.mjs --package workspace/fisher/.runtime/protocol-knowledge/formalized-package.json --dry-run`.
6. Run the static Fisher/Hermes contract check:
   `node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --check-hermes-contract`.
7. Run one non-dry-run trace summary post in a test thread and confirm the
   command reports `auditor_receipt_entry=...`.
8. Verify live ownership from the Mac Mini: Hermes gateway, Slack allowlist,
   home channel, repo-scoped Fisher workspace, and scheduled jobs.
9. Confirm the enabled `hey-mgmt-activity-ingestion-pipeline` and
   `hey-mgmt-protocol-knowledge-publisher` cron jobs exist, the legacy
   per-source and deployment-share jobs are disabled, and Hermes remains the
   only conversational Slack ingress for Fisher.

## Verification

```bash
./hey validate
node workspace/fisher/scripts/audit-hermes-crons.mjs
node --test workspace/fisher/scripts/*.test.mjs
node --test scripts/lib/__tests__/activity.test.mjs workspace/fisher/external-activity-runtime/lib/*.test.mjs
node --test scripts/lib/__tests__/auditor-deployment-shares.test.mjs
node --test workspace/fisher/external-activity-runtime/lib/auditor-publication-summary.test.mjs
node --test workspace/fisher/external-activity-runtime/protocol-knowledge-publisher.test.mjs
```

Live operator verification happens on Hermes on the office Mac Mini.

The cron audit MUST pass before adding or increasing a scheduled Hermes agent
job. It estimates enabled isolated turns from the canonical declarations and
fails when `hermes.token_policy.max_agent_turns_per_day` is exceeded. The live
scheduler MUST still be reconciled separately because the YAML does not
auto-register or remove Hermes jobs.

## References

- [How to talk to Fisher](../../docs/FISHER_GUIDE.md) — user-facing interaction guide
- [External Activity Runtime docs](../../docs/EXTERNAL_ACTIVITY_RUNTIME.md)
- [Architecture](./ARCHITECTURE.md)
- [Skill: hey-mgmt-activity](./skills/hey-mgmt-activity/SKILL.md)
- [Skill: hey-mgmt-slack-agent](./skills/hey-mgmt-slack-agent/SKILL.md)
