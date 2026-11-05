# External Activity Runtime

Collector libraries used by the `hey activity poll <source>` CLI command.

Nothing in this directory runs as a standalone process. All scheduling is
handled by Hermes on the office Mac Mini where Fisher runs.

## Collectors

- `slack-collector.mjs` — polls Slack channels via Web API
- `confluence-collector.mjs` — polls Confluence pages
- `drive-collector.mjs` — polls Google Drive changes
- `github-collector.mjs` — polls GitHub activity

Hermes drives them through `node scripts/hey.mjs activity poll <source>`.

Normal production flow:

1. Hermes starts one isolated repo-scoped turn every 30 minutes
2. the turn uses [`hey-mgmt-activity`](../skills/hey-mgmt-activity/SKILL.md)
3. the turn polls Slack, Confluence, Drive, and GitHub in sequence
4. the deployment-share gateway runs mechanically after Slack polling
5. candidate preparation is bounded before model context; classification and
   finalization happen in the same Hermes/Fisher flow

Separate per-source agent crons MUST NOT be registered. The checked-in
`hey-mgmt-activity-ingestion-pipeline` declaration is the canonical scheduled owner.

## Conversational Ownership

Free-form Slack conversation belongs to:

- Hermes Slack gateway
- the repo-scoped `hey-mgmt` agent
- [`hey-mgmt-slack-agent`](../skills/hey-mgmt-slack-agent/SKILL.md)

## Member Inbox Notifications

`node workspace/fisher/external-activity-runtime/inbox-slack.mjs notify` posts newly observed inbox items to
`#hey-mgmt-internal`. It sends at most one message per member per run, mentions
that member, and adds Ack/Discard buttons to each item. Delivery state lives in
`.runtime/inbox-notify-state.json`; only successfully posted items are marked,
and overflow is left for the next run.

Before rollout, render the real open-inbox payload without Slack writes or
state changes:

```bash
node workspace/fisher/external-activity-runtime/inbox-slack.mjs notify --dry-run
```

The active Socket Mode owner is the Hermes Slack gateway. Its
`fisher-inbox-actions` Slack action plugin MUST route `fisher_inbox_ack` and
`fisher_inbox_discard` button actions to:

```bash
node workspace/fisher/external-activity-runtime/inbox-slack.mjs action \
  --action <ack-or-discard-from-action-value> \
  --member <member-from-action-value> \
  --item <item_id-from-action-value> \
  --actor-slack-user-id <payload.user.id>
```

The action bridge MUST use the button `value` JSON as the target and the
top-level Slack `user.id` as the actor; it MUST NOT substitute either from
message text. `lib/inbox-slack-action.mjs` is the shared parser for this
contract. The command enforces that the actor owns the addressed inbox and
rejects stale or already-processed items. The plugin source is tracked at
`plugins/fisher-inbox-actions/`; install its `__init__.py` and `plugin.yaml`
under `~/.hermes/plugins/fisher-inbox-actions/` and restart the Hermes gateway
to load a new version. After a successful Ack, it replaces only that item's
action block in the original threaded message and adds a `white_check_mark`
reaction. A failed/forbidden Ack leaves Slack untouched; an update or reaction
failure is reported ephemerally without rolling back the already-completed inbox
operation. The bot needs Slack `reactions:write` permission to add the emoji.
Return the command's `text` as an ephemeral Slack response. The checked-in
schedule and operator prompt are in
[`../inbox-slack-cron.md`](../inbox-slack-cron.md).

## Auditor Publication Summaries

`auditor-trace-summary.mjs` is the Fisher-side trace consumer for Auditor
publication receipts. It fetches:

```text
GET /api/auditor/traces/{operationId}
```

and renders the structured `publicationReceipts[]` records before any legacy
publication evidence fact. When no receipt exists, the output says the durable
publication receipt is missing and only lists evidence-fact permalinks as
fallback context.

```bash
node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --operation-id op_...
node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --operation-id op_... --channel CDEPLOY
node workspace/fisher/external-activity-runtime/auditor-trace-summary.mjs --check-hermes-contract
```

Live setup happens on the Mac Mini after Auditor/Observatory deployment. Add
`AUDITOR_API_URL`, `AUDITOR_READ_TOKEN`, `AUDITOR_COLLECT_URL`, and
`AUDITOR_COLLECT_TOKEN` to Hermes runtime env at `~/.hermes/.env`; use
`workspace/fisher/external-activity-runtime/.env` only for direct shell
dry-runs. Then run a trace-summary dry run before enabling Slack posting.
The static `--check-hermes-contract` check verifies the checked-in Fisher/Hermes
contract: trace read env names, repo-scoped agent binding, Slack allowlist
policy, and expected source cron declarations. Live gateway state still must be
verified on the Mac Mini.

When `auditor-trace-summary.mjs` posts to Slack with `--channel`, it also writes
a `publication_receipt` entry to the Auditor collect gateway. The command should
print `auditor_receipt_entry=...` after a successful post. Use
`--skip-auditor-receipt` only for emergency Slack-only posting; normal trace
summary posts MUST keep the Auditor receipt write enabled.

## Local Testing

```bash
node --test scripts/lib/__tests__/activity.test.mjs workspace/fisher/external-activity-runtime/lib/*.test.mjs
```
