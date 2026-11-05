# Fisher Member Inbox Slack Cron

## Contract

- Owner: Fisher through the Hermes `hey-mgmt` repo-scoped agent.
- Destination: `#hey-mgmt-internal` (`C0A8A1ELH9A`).
- Schedule: `0 */2 * * *`, timezone `Asia/Seoul`.
- Command: `node workspace/fisher/external-activity-runtime/inbox-slack.mjs notify`.
- The turn MUST run in `/Users/hey-mgmt/workspace/hey-mgmt` and pull the
  latest `main` before invoking the command.
- The turn MUST NOT commit runtime delivery state; `.runtime/` remains local.
- A failed member delivery MUST remain unnotified so a later run can retry it.
- Button actions remain owned by the Socket Mode `slack-interactive-proxy`,
  using the callback contract in `external-activity-runtime/README.md`.

The declaration in `config/external-activity.yml` is canonical but does not
register itself in live Hermes.

## Preflight

On the office Mac Mini:

```bash
cd /Users/hey-mgmt/workspace/hey-mgmt
git pull --rebase origin main
node workspace/fisher/external-activity-runtime/inbox-slack.mjs notify --dry-run
node workspace/fisher/scripts/audit-hermes-crons.mjs
```

Confirm the dry-run contains only `alice`, `charlie`, `bob`, and `dana`, every
delivery targets `C0A8A1ELH9A`, no message exceeds 50 Block Kit blocks, and the
cron audit remains within `max_agent_turns_per_day`.

## Cron Registration Instruction

Give the following instruction to the Hermes operator on the office Mac Mini:

> Register one enabled Hermes cron job named `hey-mgmt-member-inbox-notify`
> for the repo-scoped `hey-mgmt` agent. Use cron expression
> `0 */2 * * *` with timezone `Asia/Seoul`, delivery mode `local`, and workdir
> `/Users/hey-mgmt/workspace/hey-mgmt`. On every run: execute
> `git pull --rebase origin main`; if it succeeds, execute
> `node workspace/fisher/external-activity-runtime/inbox-slack.mjs notify`. Do not commit `.runtime/` state.
> Keep the job failed if pull or notify fails, and include stderr in the local
> delivery. Do not create a second scheduler or a pm2 service.

## Rollout Verification

After registration:

```bash
hermes status
hermes agents bindings --json
hermes cron list --json
pm2 list
```

Verify the Slack binding still points to `hey-mgmt`, the channel remains
allowlisted, `hey-mgmt-member-inbox-notify` has the exact schedule/timezone,
and no legacy pm2-managed Fisher scheduler exists. Run the cron once manually,
then verify one mentioned `#hey-mgmt-internal` message per member with pending
items. Click Ack and Discard using the addressed member account and confirm the
items move out of `workspace/<member>/inbox/open/`; repeat from a different
member and confirm it is rejected. Finally, confirm the next scheduled run is
`ok` and does not resend processed/notified items.

Rollback: disable or remove only `hey-mgmt-member-inbox-notify`. The CLI and
button handler remain safe for manual use.
