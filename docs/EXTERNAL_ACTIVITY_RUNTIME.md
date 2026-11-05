# External Activity Runtime

The external activity system is now **Hermes-centric**.

## Core Contract

Canonical knowledge still lives only in:

- `content/`
- `workspace/`

The external activity system remains a bridge from Slack, Confluence, Drive, and meeting signals into that markdown-first core. Nothing about the cutover changes the canonical contract:

- only `./hey` commands mutate canonical artifacts
- validation still gates writes
- runtime state still lives in `.runtime/` and `.hey/`
- source references still use extension fields such as `x_external_refs`

## Current Ownership

| Responsibility | Owner |
| --- | --- |
| Slack DM + allowlisted mentions | Hermes native Slack |
| Scheduled polling/classification/finalize/notify | Hermes cron |
| Moderation buttons and fallback commands | Hermes native Slack |
| Canonical mutations | `node scripts/hey.mjs activity *` |
| Legacy full runtime | break-glass only |

## Why This Architecture

The old Fisher-centric model had one custom Node.js runtime owning:

- Socket Mode Slack chat
- collector scheduling
- moderation digest/update delivery
- free-form chat agent behavior

That created two problems:

1. Slack felt like it was talking to Codex/Hermes, but often talked to a constrained intermediary instead.
2. Production responsibility was split between a custom runtime and Hermes reasoning.

The Hermes-native cutover fixes that by making the Hermes agent the single execution brain for:

- Slack repo conversation
- scheduled activity pipeline turns
- moderation button handling plus fallback commands
- repo-aware shell/tool execution

The cutover removes pm2 from normal production entirely.

## Data Flow

### Scheduled activity

1. Hermes cron starts an isolated turn on the repo-scoped `hey-mgmt` agent
2. the turn runs `node scripts/hey.mjs activity poll <source>`
3. the turn runs `node scripts/hey.mjs activity prepare-candidates`
4. the agent classifies unmatched events using the repo skill
5. the turn runs `node scripts/hey.mjs activity finalize-reflections --data '{...}'`
6. the team sees digest/update notifications with reject, revoke, or delete buttons

### Scheduled maintenance

- Hermes runs `node scripts/hey.mjs activity auto-compact-knowledge` daily at 03:15 KST.
- The command pulls latest `main`, checks append-only knowledge garbage pressure, and compacts only when the cooldown and thresholds in `content/policies/external-activity.yml` allow it.
- Manual emergency compaction remains available via `node scripts/hey.mjs activity compact-knowledge`, but normal cron should use the threshold-aware auto command.

### Conversational Slack

1. Slack DM or allowlisted mention enters Hermes native Slack
2. Slack is routed to the repo-scoped `hey-mgmt` agent
3. reads/searches/status checks execute immediately
4. Slack DMs from authenticated TeamOS team members are treated as already-confirmed intent, including ordinary writes
5. allowlisted-channel writes and untrusted DMs still require a confirmation turn
6. explicit moderation button clicks, or fallback `reject <id>` / `revoke <sig>` / `delete-observation <sig>` commands, execute directly as already-confirmed intent

## Required Production State

### Hermes

- Slack `groupPolicy` must be `allowlist`
- Slack allowlist must contain only the team channels:
  - `C0AC9CBPPJS`
  - `C0A8A1ELH9A`
  - `C08RB11D5PE`
  - `C08K28MAL3C`
- repo-scoped agent id must be `hey-mgmt`
- agent workspace must be `/Users/hey-mgmt/workspace/hey-mgmt`
- Slack channel binding must route to `hey-mgmt`

## Break-Glass Path

The old full runtime is still available behind:

```bash
SUPEREARN_ENABLE_LEGACY_ACTIVITY_RUNTIME=1 node workspace/fisher/external-activity-runtime/run.mjs
```

It exists for emergency debugging only. If that env var is absent, `run.mjs` exits immediately with guidance to use Hermes native Slack + cron.

## Verification Commands

```bash
hermes status
hermes agents list
hermes agents bindings --json
hermes cron list
./hey validate
node --test scripts/lib/__tests__/activity.test.mjs workspace/fisher/external-activity-runtime/lib/*.test.mjs
```
