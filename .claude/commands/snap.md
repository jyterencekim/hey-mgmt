Quick snapshot. Survey all repos, update the daily log checklist, append a time-stamped entry, commit, and push.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Run these steps in order:

1. Read the member identity from `.env` (the `MEMBER` variable). If not set, ask the user for their name.

2. Gather current state (run in parallel where possible):

   **Loop control surface:**
   ```bash
   ./hey loop brief --member $MEMBER
   ./hey loop board --member $MEMBER
   ./hey loop horizon --member $MEMBER --json
   ```

   Use the brief + board to identify lane changes, due scheduled packets, active runs, and driver actions before writing the snap. Forward-tense horizon data stays out of the daily log (the log is pastward; the digest carries the forward view — [`decision_adr-loop-control-driver-surface`](../../content/decisions/decision_adr-loop-control-driver-surface.md), Amendment 2026-08-14).

   **a) In-flight work (multiple sources):**
   ```bash
   # Formally claimed task
   ./hey work current
   # Ready `do`-priority tasks owned by this member (likely in-flight even if not claimed)
   # Priority semantics: see decision_adr-replace-p0-p3-priority-wit
   ./hey task list --status ready --owner $MEMBER
   # Doing tasks
   ./hey task list --status doing --owner $MEMBER
   # Done tasks (for checklist update)
   ./hey task list --status done --owner $MEMBER
   ```

   **b) Today's commits in this repo:**
   ```bash
   git log --oneline --since="midnight"
   ```

   **c) Survey all working repos** (run both in parallel):
   ```bash
   bash scripts/repo-survey.sh $MEMBER
   bash scripts/gh-survey.sh $MEMBER --since 1
   ```
   `repo-survey.sh` scans local clones. `gh-survey.sh` queries GitHub for open/merged PRs and open issues. Use both to determine in-flight work.

   **Determine in-flight work:** Combine all sources to figure out what the member is working on:
   - If `work current` returns a claimed task, use that as primary in-flight work
   - Otherwise, infer from: loop `In flight` lane, ready `do`-priority tasks owned by member, today's commits mentioning task IDs, and cross-repo commit activity
   - If a task has in-progress, failed, or review-ready agent runs, inspect recent attempts:
     ```bash
     ./hey work runs --task <task_id> --limit 5
     ```
   - Summarize the most likely in-flight work (don't say "no in-flight task" when there's clearly active work)
   - If the snap reveals a task is ready to hand to an AI agent, record `./hey mission compile --task <task_id>` as the next action rather than starting a new execution inside `/snap`.

3. If today's daily log still has a legacy `## Horizon` section, leave its content as-is — do not refresh it. Forward-tense data no longer lives in the log ([`decision_adr-loop-control-driver-surface`](../../content/decisions/decision_adr-loop-control-driver-surface.md), Amendment 2026-08-14); the morning digest (`./hey loop digest --member $MEMBER`) is the forward view.

4. Reconcile the `## Plan` checklist in today's daily log at `workspace/$MEMBER/logs/YYYY-MM-DD.md`:

   - Read the current log file
   - Identify the Plan section: everything between `## Plan` and the next `##` heading (typically `## Log`)
   - For **every** `- [ ]` item in the Plan section — regardless of which subsection it appears in (flat items, `🎯 Iteration Goals`, `🔨 Today's Focus`, or any other subsection) — check ALL of these sources to determine if the item is done:
     1. **Done tasks** — a `done` task's title or ID (`task_xxx`) semantically matches the item text (literal ID match or semantic title match)
     2. **ARGUMENTS** — the user's snap arguments mention completing or shipping something that matches
     3. **Conversation context** — work done earlier in this conversation that clearly resolves the item
     4. **Today's commits** — commit messages across repos that indicate the item's work was completed
   - If matched by any source, replace `- [ ]` with `- [x]` and append a brief completion note
   - Only tick items where there is clear evidence from at least one source — don't guess on weak matches
   - Preserve all other content in the Plan section exactly as-is
   - If no checklist items need updating, skip this step

5. Append a snapshot entry under `## Log` with the current KST time:

   ```markdown
   - HH:MM — Snap: [1-line summary of current state — what's in-flight, loop lane changes, recent commits, notable repo activity]
   ```

   Rules:
   - Use current KST time (`date +%H:%M` in KST)
   - Keep the summary to one concise line
   - Mention in-flight work (inferred or claimed), count of today's commits, loop items that changed driver action, due packets handled or still due, and any notable cross-repo activity
   - If a packet was handled, record the result in the packet note or the linked task/note before committing.
   - If a task moved lanes because of the snap, update the task or daily log so the next `loop brief` can derive the same state.

6. Commit and push:
   ```bash
   git add workspace/$MEMBER/logs/YYYY-MM-DD.md
   git commit -m "Snap — HH:MM KST progress snapshot"
   git push origin main
   ```

7. Confirm with a brief status line:
   ```
   Snapped at HH:MM KST — [what was logged, and which checklist items were ticked if any]
   ```
