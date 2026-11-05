End-of-day routine. Reflect on the day's work, distill lessons, and prepare for tomorrow.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


Principles:
- **State changes > activity logs**: Focus on what was decided, what moved, what risks shifted — not just what was done.
- **Distillation**: Extract 1–3 lessons from the day's raw work. Archive the noise, keep the insight.
- **Provenance**: Cite evidence (commits, task IDs, PRs) for every claim.
- **Open threads**: Surface unfinished work so tomorrow's morning routine can pick it up seamlessly.
- **Loop closeout**: Convert open loop lanes into tomorrow's priorities, blockers, review items, or scheduled action packets.

Run these steps in order:

1. Read the member identity from `.env` (the `MEMBER` variable). If not set, ask the user for their name.

2. Rebuild indexes (needed for accurate queries):
   ```bash
   ./hey index build
   ./hey db build
   ```

3. Gather today's state changes:

   **Loop control state**:
   ```bash
   ./hey loop brief --member $MEMBER
   ./hey loop board --member $MEMBER
   ./hey packet list --member $MEMBER --include-future
   ```

   Use this to close the day from the driver's control surface, not from raw activity volume. Read [`playbook_loop-control-usage-guide`](../../content/playbooks/playbook_loop-control-usage-guide.md) if the loop rules are unclear.

   **a) Today's commits** (all team, highlight member's):
   ```bash
   git log --oneline --since="midnight" --all
   ```

   **b) Task state snapshot** — what's done, ready, doing, blocked for this member:
   ```bash
   ./hey search "" --type task --status done --owner $MEMBER
   ./hey search "" --type task --status ready --owner $MEMBER
   ./hey search "" --type task --status doing --owner $MEMBER
   ./hey search "" --type task --status blocked --owner $MEMBER
   ```

   **c) Read today's daily log** if it exists at `workspace/$MEMBER/logs/YYYY-MM-DD.md` — this has the morning plan and time-stamped journal entries. Parse `HH:MM` timestamps to calculate time spent per work item.

   **d) Read any decisions created or updated today:
   ```bash
   git log --oneline --since="midnight" --name-only -- 'content/decisions/'
   ```

   **e) Survey all working repos** for today's activity (run both in parallel):
   ```bash
   bash scripts/repo-survey.sh $MEMBER
   bash scripts/gh-survey.sh $MEMBER --since 1
   ```
   `repo-survey.sh` scans local clones (commits, staged, uncommitted changes since midnight). `gh-survey.sh` queries GitHub for open PRs, recently merged PRs, and open issues. Together they give the full picture for the nightly reflection's Repo Activity section.

   **f) Final Plan reconciliation** — update the `## Plan` checklist as a last pass before reflecting:

   - Read today's daily log (already loaded in step 3c)
   - For every remaining `- [ ]` item in the Plan section (between `## Plan` and `## Log`), check against the done tasks from step 3b:
     - If a done task's ID or title semantically matches the item, replace `- [ ]` with `- [x]`
   - This is a final catch-up — items already ticked by `/snap` during the day are left as-is
   - Preserve all other Plan content exactly as-is

4. Present a **Nightly Reflection** in this format:

   ```markdown
   ## Nightly Reflection — YYYY-MM-DD

   ### State Changes
   - [What tasks were completed today, with IDs]
   - [What tasks were created or became blocked, with reasons]
   - [What decisions were made, with references]
   - [What was deployed, merged, or shipped]

   ### Loop Control
   - Decision: [item that still needs judgment, with next driver action]
   - Unblock: [blocked item, with blocker owner or missing input]
   - Review: [output or run needing review]
   - Packet: [scheduled action packet handled or still due]
   - Agent runs: [active/failed/review-ready runs that need follow-up]

   ### Time Spent
   - [Work item]: ~Xh Ym (HH:MM – HH:MM)
   - [Work item]: ~Xh Ym (HH:MM – HH:MM)
   - **Total productive time**: ~Xh Ym

   ### Commits (N in this repo, M across all repos)
   - [One-line per commit in this repo, grouped by author if multi-person]

   ### Repo Activity
   - [Summary of work across ALL repos from the repo-survey — include every repo with activity]
   - [Note any uncommitted changes that should be committed or stashed]
   - [If a repo had significant work, list its commits briefly]

   ### Observations
   - [1–3 distilled observations from the day's work. What stood out?]
   - [Focus on reusable patterns, gotchas, or approaches worth noting]

   ### Open Threads
   - [Unfinished work that needs attention tomorrow]
   - [Pending reviews, unanswered questions, blockers]
   - [Risks or things that might go wrong if left unattended]

   ### Tomorrow's Priority
   1. [Top focus item for tomorrow morning]
   2. [Second priority, if applicable]
   ```

   Rules:
   - Omit any section that has nothing to report (e.g., no decisions → skip that bullet)
   - Be concise — one line per item, cite task/commit IDs
   - In `Loop Control`, include only items that need a future human or agent action. Healthy in-flight work belongs in State Changes or Open Threads, not as noise.
   - Observations should be genuinely reusable suggestions or patterns, not just "finished X" restated
   - Tomorrow's priority should flow naturally from open threads and the highest-attention loop lanes: `Needs decision`, `Needs unblock`, `Needs review`, due packets, then stale `Needs attention`
   - Time Spent: Calculate from daily log `HH:MM` timestamps (primary) and commit timestamps (secondary). If two consecutive log entries bracket a work item, use them as start/end. Commit timestamps are valid evidence for corroborating or filling gaps — e.g., first and last commit on a task bracket its active period. However, do not fabricate durations without data. For periods with no log entries and no commits, write `[no data]` instead of guessing.

5. **Walk every Open Thread** and resolve each into one of four outcomes (MUST, not optional):

   For each item in the `### Open Threads` section of the reflection, ask the member:

   > "<thread title>" — convert to task / schedule packet / drop / leave open?

   Apply per outcome:
   - **convert to task**: invoke `/task` to create or update a task; commit it to an `iteration` (or leave it in backlog). Set a `due_date` only when a genuine hard external deadline exists ([`decision_adr-three-layer-task-timeline`](../../content/decisions/decision_adr-three-layer-task-timeline.md)). The thread is then carried by the task ledger, not the open-threads list.
   - **schedule packet**: pick a `trigger-at` date (default: ~2 days before the next decision/check point); create the packet:
     ```bash
     ./hey packet new --workspace $MEMBER --title "<thread title>" --trigger-at YYYY-MM-DD --audience $MEMBER --action "<what to do when surfaced>"
     ```
   - **drop**: remove the line from the Open Threads section; the thread is intentionally dead.
   - **leave open**: keep it in Open Threads if it's actively in tomorrow's first hour; otherwise prefer one of the other three.

   Rules:
   - The Open Threads list MUST shrink each night unless the member explicitly chooses `leave open` for each item.
   - Packets are for genuine one-off time-triggered reminders and light checks only. If the follow-up is substantive work, use `convert to task` — task re-surfacing is the iteration carry mechanism's job, not a packet's ([`decision_adr-three-layer-task-timeline`](../../content/decisions/decision_adr-three-layer-task-timeline.md), Alternatives §4). Do not use packets as a second task system — see [`decision_adr-loop-control-driver-surface`](../../content/decisions/decision_adr-loop-control-driver-surface.md).

6. **Extract observations as ideas** (optional):
   After generating the Observations section of the Nightly Reflection, check if any observation is novel (not already captured as an idea in `workspace/$MEMBER/ideas/`).
   If any are novel, offer:
   > "These observations look capture-worthy. Save any as ideas?"
   - Present each candidate observation briefly
   - On confirmation, write selected ones to `workspace/$MEMBER/ideas/` using the `/idea` ontology (frontmatter with `id: note_YYYY-MM-DD-slug`, `type: note`, `status: active`, `x_kind: observation`, today's date)
   - On decline, move on
   - Skip this step if `workspace/$MEMBER/ideas/` doesn't exist and the member hasn't used `/idea` before

7. Append the reflection to today's daily log file at `workspace/$MEMBER/logs/YYYY-MM-DD.md`:
   - Add it under a `## Reflection` section at the end
   - If the daily log doesn't exist, create it with just the Reflection section
   - If a Reflection section already exists, replace it with the updated one

8. **Memory sync** (dry-run):
   Run `/upload-memory --dry-run` to check for new cross-repo memories worth sharing.
   If there are candidates, report them in the reflection's Observations section and suggest
   the user run `/upload-memory` to apply.

9. Quick validation pass:
   ```bash
   ./hey validate
   ```
   If there are errors, fix them and re-validate.

10. If any files were changed during this routine (including the daily log), commit and push:
   - Commit the daily log update: `Add nightly reflection for YYYY-MM-DD`
   - Commit any validation fixes separately with descriptive messages
   - Stage only the relevant files per commit (no `git add -A`)
   - Push to remote:
     ```bash
     git push origin main
     ```
