---
name: desk-daily
description: Command-free daily work desk loop (start-of-day open, mid-day check/snap/claim/standup, end-of-day close & reflection). Triggers when the member starts work, asks what to do today, logs progress, or wraps up for the day without needing slash commands.
---

# Daily Desk Loop (`open` · `flow` · `close`)

Operate `hey-mgmt` as a continuous work desk across any AI agent. Read `MEMBER` and `LANGUAGE` from `.env` (if missing, switch immediately to `.agents/skills/desk-bootstrap/SKILL.md`). Always show task `title` before `id` (`decision_adr-display-task-titles-not-ids`) and follow `playbook_interaction-tone` (`recognition → reminders`).

---

## Mode A — Start of Day (`open`)

Triggers: "start my day", "morning", "출근", "오늘 뭐 할까", or first session of the day when `workspace/$MEMBER/logs/YYYY-MM-DD.md` has no `## Plan`.

1. **Sync & Catch-Up:**
   - Pull latest changes (`git pull --rebase --autostash origin main`, offline-safe).
   - Check connector freshness via `./hey connector status --json`. If any enabled connector has `stale: true`:
     - For `api-token` sources: run `FISHER_ACTIVITY_BATCH_NO_GIT_SYNC=1 ./hey activity poll <source>`.
     - For `agent-mcp` sources: fetch recent items since `last_polled_at` using host-agent MCP/plugin tools and pipe into `./hey activity push-events --stdin --owner $MEMBER --prepare`.
   - Rebuild indexes: `./hey index build && ./hey db build`.
2. **Compile Morning Surface:**
   - Run `./hey loop digest --member $MEMBER --record --json` (or without `--json` for readable markdown), `./hey loop brief --member $MEMBER`, and `./hey loop horizon --member $MEMBER`.
   - Check open incoming inbox items (`./hey inbox list --workspace $MEMBER`, `kind === "member-send"`).
   - Check overdue hard deadlines (`due_date < TODAY` for `ready | doing | blocked`) and require an explicit triage action (`defer` / `done` / `archive` / `drop due_date`) if any exist.
   - Read yesterday's `workspace/$MEMBER/logs/YYYY-MM-DD.md` (`## Reflection` / `Open Threads` / `Tomorrow's Priority`), live `workspace/$MEMBER/ideas/` (`status: active`), `bash scripts/gh-survey.sh $MEMBER --since 1`, and the active weekly iteration log (`content/notes/**/note_iteration-log-*.md`).
3. **Ensure Today's Daily Log Exists:**
   - Target: `workspace/$MEMBER/logs/YYYY-MM-DD.md`.
   - If the scheduled `desk-morning-prep` cron already created `<!-- fisher:digest:start --> ... <!-- fisher:digest:end -->`, **merge** `## Plan` and `## Log` cleanly around it — never overwrite the marker block.
   - Present a crisp daily focus plan (loop lanes `Needs decision` / `Needs unblock` / `Needs review` first, then `do`-priority planned tasks) and confirm today's `## Plan` with the member.

---

## Mode B — During the Day (`flow`: status · snap · claim · standup)

Triggers: "status check", "snap", "checkpoint", "what's next", "standup", "진행 기록", "다음 작업".

- **Quick Status Check:** Read-only scan via `./hey work current`, `./hey task list --owner $MEMBER`, `./hey inbox list --workspace $MEMBER`, today's `workspace/$MEMBER/logs/YYYY-MM-DD.md`, `bash scripts/repo-survey.sh $MEMBER`, and `bash scripts/gh-survey.sh $MEMBER --since 1`.
- **Progress Snapshot (`snap`):**
  1. Survey in-flight state (`./hey work current`, `./hey loop brief --member $MEMBER`, `repo-survey.sh`, `gh-survey.sh`).
  2. Reconcile matching `- [ ]` checkboxes in `## Plan` of today's log when clear evidence (done task, commit, or conversation output) exists.
  3. Append `- HH:MM — Snap: <concise 1-line summary>` under `## Log` (KST or member local HH:MM).
  4. Stage only `workspace/$MEMBER/logs/YYYY-MM-DD.md` (and any updated task files), validate (`./hey validate`), commit, and push.
- **Claim Next Task (`whatnext`):**
  1. Check `./hey work current` (resume or fail before claiming a new one).
  2. Run `./hey index build && ./hey work claim --next`.
  3. Execute against `definition_of_done`, follow `.agents/skills/update-task-tree/SKILL.md`, and complete with `./hey work complete --task <id>`.
- **Standup Summary:** Query `done`, `ready`, and `blocked` tasks for `$MEMBER`, format Done / Doing / Blocked, and optionally save `./hey new --workspace $MEMBER --type note --title "Standup YYYY-MM-DD"`.

---

## Mode C — End of Day (`close`)

Triggers: "wrap up", "end of day", "night", "퇴근", "하루 마감".

1. **Rebuild & Survey:**
   - Run `./hey index build && ./hey db build`.
   - Run `./hey log scaffold --member $MEMBER` to capture today's commits, agent runs, and touched tasks inside `<!-- fisher:scaffold:start --> ... <!-- fisher:scaffold:end -->`.
   - Run `bash scripts/repo-survey.sh $MEMBER` and `bash scripts/gh-survey.sh $MEMBER --since 1` to cover sibling repos.
   - Check `./hey loop brief --member $MEMBER` and `./hey packet list --member $MEMBER --include-future`.
   - Reconcile remaining `## Plan` checkboxes in `workspace/$MEMBER/logs/YYYY-MM-DD.md` against completed tasks.
2. **Present Nightly Reflection & Resolve Open Threads:**
   - Summarize `State Changes`, `Loop Control`, `Time Spent` (from `## Log` and commit timestamps — never fabricate durations), `Repo Activity`, `Observations` (1–3 reusable insights), `Open Threads`, and `Tomorrow's Priority`.
   - For **every** `Open Thread`, ask the member to resolve it into one of: `convert to task` (`./hey new --type task`), `schedule packet` (`./hey packet new`), `drop`, or `leave open` (only for tomorrow's first hour).
   - Offer to save novel observations into `workspace/$MEMBER/ideas/` (`x_kind: observation`).
3. **Persist, Validate, Commit & Push:**
   - Update `## Reflection` at the end of `workspace/$MEMBER/logs/YYYY-MM-DD.md` without altering `## Plan` or `## Auto scaffold` markers.
   - Run `./hey validate`.
   - Stage only changed files by explicit name (NEVER `git add -A`), commit (`Add nightly reflection for YYYY-MM-DD`), rebase safely if needed (`playbook_agent-commit-and-shell-hygiene`), and push to `origin main`.
