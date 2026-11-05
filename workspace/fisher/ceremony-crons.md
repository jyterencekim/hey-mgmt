# Ceremony Crons

Registration prep for the D2 pilot (charlie). Design:
`content/notes/2026/08/note_automated-initiative-task-hygiene-strategy.md` (P3).
Implemented 2026-08-14 in `scripts/hey.mjs` (`loop digest`, `log scaffold`,
`iteration prepackage`). Declared in
`workspace/fisher/config/external-activity.yml` under `hermes.cron_jobs`.
Hermes registration completed on the Mac Mini on 2026-08-18. This file is the
operator runbook.

## Boundary

Fisher sets the table; the member eats. All three commands are mechanical
projections. No judgment, no archiving, no reflections. The only canonical
writes are due-packet surfaced-markers (`loop digest --record`) and the
marker-scoped `## Auto scaffold` section (`log scaffold`). Morning digests are
forward-looking output only; `workspace/<member>/logs/` is the sole
repo-managed daily record.

## Opt-in

Per-member jobs run only for members with `x_ceremony_cron: true` in
`content/vocab/members.yml`. Today that is charlie only. The turn MUST check
this before running a per-member command. `iteration prepackage` is team-level
and runs while at least one member is opted in.

## Jobs

Registered Hermes jobs (all `deliver: local`, workdir
`/Users/hey-mgmt/workspace/hey-mgmt`):

- `charlie-loop-digest` — `0a40f4d662b3`
- `charlie-log-scaffold` — `5f4e37b41a95`
- `hey-mgmt-iteration-prepackage` — `510fe93c6e3d`
- `hey-mgmt-product-initiative-alert` — `720dc0d2c0ff` (registered 2026-11-03; enabled; Asia/Seoul; script-only)

### charlie-loop-digest

- Schedule: `30 8 * * *` Asia/Seoul (daily 08:30 KST).
- Turn steps, same shape as `hey-mgmt-index-rebuild`:

  ```bash
  git pull --rebase
  node scripts/hey.mjs index build && node scripts/hey.mjs db build
  node scripts/hey.mjs loop digest --member charlie --record
  git add -u
  git commit -m "digest: morning charlie" && git push origin main
  ```

- Output: **`workspace/charlie/logs/YYYY-MM-DD.md`** — the daily log, created if
  absent, written between `<!-- fisher:digest:start -->` and
  `<!-- fisher:digest:end -->` under a `## Loop Control — auto (…)` heading.
  Idempotent: re-running replaces only that region. This is the durable
  artifact; there is no `digests/` directory and no separate digest file.

- **The digest never writes a `## Plan`.** A plan is a commitment and stays
  member-authored. That is what makes the 21:30 check below meaningful: a log
  with the digest section but no `## Plan` says precisely "the machine ran, the
  member has not committed to a day". The rendered digest also goes to the cron/Slack
  delivery, and inbox-delta state stays in `.hey/loop-digest/charlie.json`
  (untracked), with surfaced markers on due packets.

- **Why the log and not an ephemeral delivery.** A pass whose only output is a
  Hermes local delivery leaves the repo unable to answer "did management run
  today?". The log is what `/morning`, `/night`, the weekly report, and any
  later reader all key off, so the scheduled pass must land there or it may as
  well not have run.

- **`/morning` does not own this file.** If a member runs `/morning` later, it
  merges into what this job wrote — it must not recreate or overwrite it.

### charlie-log-scaffold

- Schedule: `30 21 * * *` Asia/Seoul (daily 21:30 KST).
- Turn steps:

  ```bash
  git pull --rebase
  node scripts/hey.mjs index build
  node scripts/hey.mjs log scaffold --member charlie
  git add workspace/charlie/logs && git commit -m "log: scaffold charlie" && git push origin main
  ```

- Output: `## Auto scaffold` between `<!-- fisher:scaffold:start -->` and
  `<!-- fisher:scaffold:end -->` in `workspace/charlie/logs/YYYY-MM-DD.md`.
  Idempotent; never touches lines outside the markers. Unbalanced markers
  fail loud — do not auto-repair; fix the file by hand.

### hey-mgmt-iteration-prepackage

- Schedule: `0 9 * * 1` Asia/Seoul (Monday 09:00 KST, before iteration-turn).
- Turn steps:

  ```bash
  git pull --rebase
  node scripts/hey.mjs index build
  mkdir -p workspace/fisher/prepackage
  node scripts/hey.mjs iteration prepackage > "workspace/fisher/prepackage/$(date +%G-W%V).md"
  git add workspace/fisher/prepackage && git commit -m "iteration: prepackage $(date +%G-W%V)" && git push origin main
  ```

- Print-only command; the redirect persists it for the ceremony. Use
  `--no-pr` if the turn has no GitHub token; the merged-PR section is then
  skipped loudly in the output.

### hey-mgmt-product-initiative-alert

- Decision: `content/decisions/decision_adr-product-initiative-kickoff.md` (D6).
- Schedule: `30 9 * * 1-5` Asia/Seoul (weekdays 09:30 KST, before the 10:00
  `hey-mgmt-member-inbox-notify` run delivers inbox items to Slack).
- Team-level job; it does not depend on `x_ceremony_cron` opt-in.
- Turn steps:

  ```bash
  bash workspace/fisher/scripts/hey-mgmt-product-initiative-alert.sh
  ```

- `initiative alert` writes one inbox item per active product initiative with
  kickoff or task gaps, addressed to the initiative owner, sender `fisher`. An
  identical gap set sent within 7 days is skipped, so most days commit nothing;
  skip the commit when `git status --short workspace/*/inbox` is empty.
- Preflight: `node scripts/hey.mjs initiative alert --dry-run`.
- Live Hermes script: `~/.hermes/scripts/hey-mgmt-product-initiative-alert.sh`
  delegates to the versioned script above; no LLM or second scheduler is used.
- The script first runs `git pull --rebase origin main` and fails immediately
  on error. It refuses pre-existing staged or inbox changes, runs the alert,
  validates, and commits/pushes only `workspace/*/inbox` when changed. It never
  stages `.runtime/`; stderr is included in local output and errors retain a
  nonzero exit status.
- Rollback: `hermes cron pause 720dc0d2c0ff` (or remove only that job).

## Run monitoring

`hermes cron list` reports whether a job *ran*. It cannot report whether
management *happened*, and checking it is itself a ritual — which is the thing
these crons exist to remove. So the daily log carries the evidence, and Hermes
double-checks the log rather than trusting its own job status.

### Hermes double-check (required, runs unattended)

**At 21:30, before `log scaffold` writes its markers**, the scaffold job MUST
verify today's log and act on what it finds. `log scaffold` already creates the
file when it is absent, so the check is about *content*, not existence alone.

1. Resolve `LOG=workspace/<member>/logs/$(TZ=Asia/Seoul date +%F).md`.
2. **If `LOG` does not exist:** the 08:30 digest job did not land and no
   `/morning` ran. This is a **loud failure**, not a quiet gap. Report it in the
   job output naming the member and date, and let `log scaffold` create the file
   — the scaffold's pastward facts are the minimum honest record for the day.
3. **If `LOG` exists but has no `## Plan` section:** the file was created by
   scaffold or by hand, but no forward-looking pass ever ran. Report it the same
   way. Do not synthesise a plan — Fisher writes pastward facts only, and
   inventing a plan nobody committed to would be worse than recording its
   absence.
4. **If `LOG` exists with `## Plan`:** management ran. No report.

The check MUST NOT auto-repair beyond letting `log scaffold` create the file.
Its output is a signal, and a signal that silently fixes what it measures stops
being a signal.

### Escalation

Two consecutive days of case 2 or 3 for the same member means the scheduled pass
is broken rather than a day being skipped — surface it as such, so it reads as
"the automation stopped" and not "charlie was busy". Do not wait for someone to
run `hermes cron list` to discover this.

### Other jobs

- Scaffold and prepackage are also checked by `hermes cron list` and their
  scoped commits when they produce a changed output. The prepackage job writes
  `workspace/fisher/prepackage/YYYY-WNN.md`; its absence on a Monday is the same
  class of loud failure as a missing log.

## Operator Steps

Precedent: README "Auditor Launch Wiring on the Mac Mini". On the Mac Mini
(`/Users/hey-mgmt/workspace/hey-mgmt`):

1. `git pull` — brings the CLI commands, the yml declaration, and this file.
2. `node scripts/hey.mjs loop digest --member charlie` (without `--record`) —
   verify the digest renders without error under the Hermes user.
3. Registration is complete. If recovery is needed, recreate the three jobs
   with the exact names, schedules, and timezones from `hermes.cron_jobs` in
   `workspace/fisher/config/external-activity.yml`
   (`charlie-loop-digest`, `charlie-log-scaffold`,
   `hey-mgmt-iteration-prepackage`). The repo yml does NOT auto-register.
4. No new env vars. The commands are offline except the prepackage PR check;
   if the turn user has no GitHub credentials, add `--no-pr` to the
   prepackage step.
5. Verify: `hermes cron list` shows the three jobs; `hermes status` healthy.
6. Next morning, confirm the job status is `ok` and inspect its local delivery
   for the rendered digest. A commit is expected only when due packets were
   newly surfaced.

Rollback: remove the three Hermes jobs. Repo-side nothing breaks — the
commands stay available for manual runs.
