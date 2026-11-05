Start-of-day routine. Sync the repo, review yesterday's threads, and produce a Slack-ready daily plan.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Principles:
- **Continuity**: Yesterday's open threads become today's starting context. No cold starts.
- **State-aware planning**: Plan from what actually changed, not from a blank slate.
- **Attention is scarce**: Snippet + next action. One line per item, priorities first.
- **Loop control**: Use the loop brief and board as the driver's control surface. Do not ask the human to mentally follow every task detail.

Run these steps in order:

1. Sync with remote:
   ```bash
   git pull --rebase origin main
   ```

2. Rebuild indexes and database:
   ```bash
   ./hey index build
   ./hey db build
   ```

3. Read the member identity from `.env` (the `MEMBER` variable). If not set, ask the user for their name.

4. Compile the loop control state:

   ```bash
   ./hey loop brief --member $MEMBER
   ./hey loop board --member $MEMBER
   ./hey loop horizon --member $MEMBER
   ```

   Use the brief as the first-pass scan. Use the board to decide what needs human attention **today**. Use the horizon to see what is **coming** — lead with the iteration view (`This iteration` with `plan:` dates, `Next iteration`, `Backlog`); the due-date windows list hard external deadlines only ([`decision_adr-three-layer-task-timeline`](../../content/decisions/decision_adr-three-layer-task-timeline.md)).

   **The daily log is the only artifact.** There is no `digests/` directory — it was removed, and `workspace/$MEMBER/logs/YYYY-MM-DD.md` is the single durable record. When the 08:30 digest cron is live for the member it has already written today's log, so **read it first and react to it instead of regenerating**: fill the gaps and correct what has changed since 08:30, rather than overwriting a file the scheduled pass authored.

   Read [`playbook_loop-control-usage-guide`](../../content/playbooks/playbook_loop-control-usage-guide.md) when the loop rules are unclear. The rationale (why projections, not a new ledger) is in [`decision_adr-loop-control-driver-surface`](../../content/decisions/decision_adr-loop-control-driver-surface.md).

   Morning planning MUST prefer these signals over raw task volume:
   - `Needs decision`
   - `Needs unblock`
   - `Needs review`
   - due scheduled action packets
   - in-progress or failed agent runs
   - stale `Needs attention` items

   Horizon signals to surface in the daily plan (when non-empty):
   - Today's planned set (`x_planned_date = $TODAY`) — this leads the plan; offer to re-plan yesterday's missed planned dates (no overdue semantics)
   - Hard-deadline buckets (`Today`, `Rest of this week`) — the only alarm-bearing dates
   - `This iteration` commitments not yet planned to a weekday
   (`No due date` is the normal backlog state under the three-layer ADR — never propose due-dating it)

5. **Review yesterday's context** for continuity:

   a) Find and read yesterday's daily log at `workspace/$MEMBER/logs/YYYY-MM-DD.md` (yesterday's date). If it has a `## Reflection` section, extract:
      - **Open Threads**: Unfinished work carried over
      - **Tomorrow's Priority**: What yesterday-me said to focus on

   b) Check overnight team activity (commits since yesterday):
   ```bash
   git log --oneline --since="yesterday" --until="midnight" --all
   ```

   If there are overnight commits by other team members, note them briefly.

   c) Read live ideas:
      Find files in `workspace/$MEMBER/ideas/` with `status: active` in frontmatter (artifact lifecycle: in force).
      If any exist, include in the daily plan (step 9) under an **Live Ideas** section:
      ```
      💡 **Live Ideas** (N open)
      - [x_kind] [title] (YYYY-MM-DD) — [first line of body]
      ```
      Ask: "Any of these to follow up on or promote today?"
      Omit this section if the directory doesn't exist or has no live ideas.

   d) Survey GitHub activity across all repos:
   ```bash
   bash scripts/gh-survey.sh $MEMBER --since 1
   ```
   This queries GitHub for open PRs, recently merged PRs, and open issues authored by/assigned to the member. Include notable GitHub activity (open PRs needing review, recently merged PRs) in the **Overnight** section of the daily plan. Omit if no activity.

6. **Check the current iteration log** (and offer to open one if missing):

   Determine the current iteration (`YYYY-WNN`) and look for:
   ```
   content/notes/**/note_iteration-log-*.md
   ```

   **If an iteration log exists** for the current week and has a `## Goals` section, extract the goals. These are team-level objectives for the week — include them in the daily plan (step 8) under the Iteration Goals section.

   **If no iteration log exists** for the current week, check whether a previous iteration log exists with `status: active` (unclosed):

   **Case A — Previous iteration is unclosed**: Ask the user:

   > No iteration log for **YYYY-WNN**, and previous iteration **YYYY-WNN** is still open. Would you like to turn to a new iteration? (This runs `/iteration-turn` — closes the old with a retrospective, carries forward unfinished items, and opens the new.)

   - **If the user accepts**: Run the `/iteration-turn` workflow. Then re-read the newly created iteration log and extract the goals for the daily plan. Resume with step 7.
   - **If the user declines**: Continue without iteration goals.

   **Case B — No previous iteration to close** (fresh start): Ask the user:

   > No iteration log found for **YYYY-WNN**. Would you like to open one now? (This runs `/iteration-open` to create the team iteration log with goals.)

   - **If the user accepts**: Run the `/iteration-open` workflow. Then re-read the newly created iteration log and extract the goals for the daily plan. Resume with step 7.
   - **If the user declines**: Continue without iteration goals.

   **In either case**, if the workflow fails for any reason (e.g., the log was already created by another team member): Report the error briefly, then continue without iteration goals. Do not block the morning routine.

7. **Check inbox for items from other members**:
   ```bash
   ./hey inbox list --workspace $MEMBER
   ```
   Filter the results for items where `kind` is `"member-send"` and `status` is `"open"`. These are notifications sent by other team members via `./hey inbox send`. If any exist, include them in the daily plan (step 9) under an **Incoming** section:
   ```markdown
   📬 **Incoming**
   - From [metadata.x_from]: [title] (`[id]`) — [first line of body, truncated]
   ```
   Omit this section if there are no incoming member-sent items. Self-captured items (`kind: "self"`) should not appear here.

8. Gather today's task context:
   ```bash
   # My ready tasks
   ./hey search "" --type task --status ready --owner $MEMBER

   # My doing tasks
   ./hey search "" --type task --status doing --owner $MEMBER

   # My blocked tasks
   ./hey search "" --type task --status blocked --owner $MEMBER

   # Recently completed (all team)
   ./hey search "" --type task --status done
   ```

9. Read each ready/doing/blocked task file to understand the full context (title, priority, project, definition of done, blockers).

10. Present a **Slack-ready daily plan** in markdown format that the user can copy-paste directly. Use this format:

   ```markdown
   **[Name] — Daily Plan (YYYY-MM-DD)**

   🎯 **Iteration Goals (YYYY-WNN)** (if iteration log exists)
   - [Goal from iteration log ## Goals section]
   - [Goal from iteration log ## Goals section]

   🔨 **Today's Focus**
   - [ ] [Task title] (`priority`) — [one-line description of what to do next]
   - [ ] [Task title] (`priority`) — [one-line description]

   📬 **Incoming** (from teammates — via `./hey inbox send`)
   - From [sender]: [title] (`inbox_id`) — [first line of body]

   🧭 **Loop Control**
   - Decision: [task or packet title] — [driver action]
   - Unblock: [task title] — [blocker]
   - Review: [task/run title] — [what to inspect]
   - Packet: [packet title] — due [date]

   📅 **Horizon** (from `./hey loop horizon`)
   - Planned today (N) · This iteration (N) · Next iteration (N) · Hard deadlines this week (N)

   🔁 **Carried Over** (from yesterday's open threads)
   - [Item from yesterday's reflection, if any]

   🚧 **Blocked**
   - [Task title] — blocked by: [reason]

   🌙 **Overnight** (team activity while you were away)
   - [Brief summary of overnight commits, if any]

   ✅ **Recently Done** (team)
   - [Task title] — [owner]
   ```

   Rules for the daily plan:
   - Order ready/doing tasks by priority (`do` first, then `plan`, `routine`, `drop`). See [`decision_adr-replace-p0-p3-priority-wit`](../../content/decisions/decision_adr-replace-p0-p3-priority-wit.md) for what each label means.
   - Choose focus from the loop lanes first. A lower-priority task in `Needs decision`, `Needs unblock`, or `Needs review` can outrank a higher-priority Ready task.
   - For each task, infer the next concrete action from the task body and definition of done
   - Yesterday's priority items should appear at the top of Today's Focus if still open (ready/doing/blocked)
   - Due scheduled action packets should appear in `Loop Control` unless they are already represented by a task or inbox item.
   - In-progress agent runs should appear only when they need driver action; do not list healthy background runs just to show activity.
   - Omit any section that has nothing to report (including Iteration Goals if no log exists)
   - Keep it concise — one line per task

11. Create a **daily log** file at `workspace/$MEMBER/logs/YYYY-MM-DD.md` (create the `logs/` directory if it doesn't exist). Use today's date. If the file already exists, skip creation and note that it's already started.

   ```markdown
   # YYYY-MM-DD

   ## Plan
   <!-- Auto-filled from the daily plan above -->

   ## Loop Control
   <!-- Auto-filled from ./hey loop brief --member $MEMBER: decisions, unblocks, reviews, due packets, active runs -->

   ## Log
   <!-- Time-stamped entries in KST. Format: "- HH:MM — description" -->
   <!-- Example: "- 09:30 — Started bridge aggregator QA" -->
   ```

   **The log MUST exist by the end of this step, whether or not you created it.** It is the artifact the whole day hangs off and the only evidence that management ran. If the 08:30 digest cron already wrote it, do not recreate or overwrite it — merge your sections into what is there and note that the scheduled pass authored the file first. If it does not exist and you are running `/morning` late in the day, create it anyway and record why it is late; a missing log reads as "management did not happen", so an honest late log is strictly better than none.

   Auto-fill rules:
   - **Plan** — daily plan generated in step 10 (plain task list, no Slack formatting).
   - **Horizon** — planned-today, iteration, and hard-deadline counts from `./hey loop horizon --member $MEMBER --json`. Omit empty buckets.
   - **Loop Control** — only non-empty loop lanes that need driver attention.

12. Tell the user that work will be journaled to the daily log throughout the session. Any significant state changes (task completions, decisions, blockers, lessons) should be appended to the `## Log` section with KST timestamps in `HH:MM` format (e.g., `- 14:30 — Completed task_bridge-aggregator`). This enables time-spent tracking in the nightly reflection.
