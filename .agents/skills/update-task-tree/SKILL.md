---
name: update-task-tree
description: Verify task completion against its Definition of Done, update status, and walk linked tasks and parent initiatives to propagate status changes.
owner: team
applies_to: [hey-mgmt, task hygiene, initiatives, closeout across repos]
updated: 2026-11-09
---

# Update Task Tree (`update-task-tree`)

Every time a tracked task advances, finishes, blocks, or is reviewed, verify its `definition_of_done` (DoD) against real evidence, update its `status` and `updated_at`, and walk its connected task and `initiative` graph so downstream tasks and parent initiatives never stay stale. This is a **passive, always-on protocol** — agents MUST run it automatically without waiting for a manual slash command.

## When to Trigger (Always-On)

Run this protocol automatically at any of these moments:

1. **Work completion or closeout:** You finish implementing, deploying, verifying, or documenting work tied to a tracked `task_*` (in `hey-mgmt` or any sibling repository).
2. **Status transition:** A task changes status (`plan → ready`, `ready → doing`, `doing → blocked`, `doing → done`, or `→ archived`).
3. **Explicit or implicit completion check:** The user mentions that a task or deliverable is finished, asks whether a task is done, or asks to clean up / sync task statuses.
4. **Session-end sweep:** Before closing out a session where one or more tasks were touched.

## The 4-Step Task Tree Walk

### Step 1 — Verify Anchor Task against `definition_of_done`

1. Read the anchor task file (`content/tasks/YYYY/MM/task_*.md`), inspecting `status`, `definition_of_done`, `relations`, and body acceptance criteria.
2. Check every criterion in `definition_of_done` against concrete evidence (commit hash, PR link, test output, deployed state, or committed artifact):
   - **All DoD criteria verified → `status: done`:**
     - Set `status: done` and bump `updated_at: YYYY-MM-DD` (today).
     - Record completion evidence in the task body or `relations` (`evidenced_by`) if not already present.
   - **Some DoD criteria verified, work actively in flight → `status: doing`:**
     - Transition `plan` or `ready` to `status: doing` immediately (never batch to session end) and bump `updated_at`.
     - State explicitly which DoD items are satisfied and which remain open. Never mark `done` with an unverified DoD item.
   - **Blocked on a dependency → `status: blocked`:**
     - Set `status: blocked`, bump `updated_at`, and ensure the blocking artifact is linked in `relations` (`type: blocked_by`) or documented in the body.
   - **Decided not to ship or superseded → `status: archived`:**
     - Set `status: archived`, bump `updated_at`, and add a one-line archival reason in the body (plus `superseded_by` relation if replaced).

### Step 2 — Walk Connected Tasks (Downstream & Sibling Edges)

Query all incoming and outgoing task relations for the anchor task (maintaining a visited set so the walk terminates cleanly on cycles):

```bash
./hey db query "SELECT src_id, rel_type, dst_id FROM relations WHERE src_id='<task_id>' OR dst_id='<task_id>'"
```

*(If the SQLite catalog is stale or missing, run `./hey index build && ./hey db build` first.)*

For each connected `task_*`:

1. **`blocks` / `blocked_by` (Unblocking downstream tasks):**
   - When the anchor task transitions to `done` or `archived`, inspect every task that was `blocked_by` the anchor task (or that the anchor task `blocks`).
   - Read that downstream task's remaining `blocked_by` targets. If **all** blockers are now `done` or `archived`:
     - If the downstream task is `status: blocked`, transition it to `status: ready` and bump `updated_at`.
     - Check whether the work just completed also satisfies the downstream task's own `definition_of_done`; if so, evaluate it via Step 1.
     - If the unblocked task belongs to another member (`owner != $MEMBER`), notify them via `./hey inbox send --to <owner> --task <downstream_id> --title "Blocker cleared: <title>"`.
2. **`follows` / `followed_by`, `links_to`, `supersedes` / `superseded_by`:**
   - Inspect sibling or follow-up tasks in the same workstream to see whether their DoD was also satisfied by the completed work, or whether a `plan` task is now ready to be surfaced.
   - If the anchor task `supersedes` another open task, transition the superseded task to `status: archived` with a one-line reason and bump `updated_at`.
3. **Recurse:** Any connected task whose status changes in Step 2 triggers its own Step 2–3 walk.

### Step 3 — Walk Up to Parent `initiative` (`child_of` / `parent_of`)

1. Find any parent `initiative_*` linked via `child_of` on the task or `parent_of` on the initiative:

   ```bash
   ./hey db query "SELECT i.id, i.title, i.status, i.owner, i.path FROM items i JOIN relations r ON (r.src_id=i.id AND r.rel_type='parent_of' AND r.dst_id='<task_id>') OR (r.src_id='<task_id>' AND r.rel_type='child_of' AND r.dst_id=i.id) WHERE i.type='initiative'"
   ```

2. If a parent initiative exists, read the initiative file and list **all** tasks in its membership (the union of `initiative --parent_of--> task` and `task --child_of--> initiative`):

   ```bash
   ./hey db query "SELECT DISTINCT t.id, t.title, t.status, t.owner FROM items t JOIN relations r ON (r.src_id='<initiative_id>' AND r.rel_type='parent_of' AND r.dst_id=t.id) OR (r.src_id=t.id AND r.rel_type='child_of' AND r.dst_id='<initiative_id>') WHERE t.type='task' ORDER BY t.status, t.id"
   ```

3. **Check sibling tasks under the same initiative:**
   - If any sibling task's DoD was also completed in the same work session (or unblocked by the anchor task), apply Steps 1–2 to that sibling task so the initiative rollup is accurate.
4. **Evaluate the `initiative` status and DoD:**
   - **Kickoff & scope rules (`decision_adr-product-initiative-kickoff`):**
     - If `x_initiative_kind: product` and `status: plan`, do **not** auto-transition to `active` unless all required kickoff fields (`x_timeline_start`, `x_timeline_end`, `x_prd_doc`, `x_components`, `x_kickoff_date`, `x_baseline_tasks`) are present; surface any missing kickoff fields instead.
     - For a kicked-off product initiative, compare current member tasks against `x_baseline_tasks`. Every baseline task and every task added via scope change MUST be `done` (or explicitly `archived` with a documented scope-change decision) before the initiative can complete.
   - **All child tasks + initiative DoD satisfied → `status: done`:**
     - When zero child tasks remain in `plan | ready | doing | blocked` (and no unfinished baseline task is unaccounted for) **and** every item in the initiative's own `definition_of_done` is verified, transition the initiative to `status: done` and bump `updated_at`.
   - **Work still in progress → keep `status: active`:**
     - Keep `status: active` (and bump `updated_at` if the initiative body/relations changed) and report the updated rollup (`done / total` tasks, plus component progress for product initiatives).
5. **Goal boundary (`contributes_to`):**
   - If the initiative links to a `goal_*` via `contributes_to`, **never** edit the goal artifact (`goal` is human-set only per `decision_adr-goal-as-seventh-type`). Surface the initiative's completion or progress in the response so the human can review goal progress.

### Step 4 — Validate and Report the Tree Delta

1. If any artifact in `content/` or `workspace/` was modified, run `./hey validate` (and `./hey index build && ./hey db build` so subsequent queries see the new statuses).
2. Include a compact **Task Tree Update** block in the response (always leading with the artifact `title` followed by its `id` in backticks, per `decision_adr-display-task-titles-not-ids`):

```markdown
**🌳 Task Tree Update**
- **Anchor task:** <Task Title> (`task_...`) — `doing → done` (DoD 3/3 verified: <brief evidence>)
- **Linked tasks:** <Downstream Task Title> (`task_...`) — `blocked → ready` (blocker `task_...` cleared)
- **Initiative:** <Initiative Title> (`initiative_...`) — `active` (4/5 tasks `done`; remaining: <Remaining Task Title> (`task_...`, `ready`))
```

## Guardrails

- **Never mark `done` on intent or promise.** A written plan, unmerged local diff (when deployment is in the DoD), or unverified claim does not satisfy a DoD item.
- **Never rewrite `x_baseline_tasks` to force an initiative `done`.** Unfinished baseline tasks block initiative completion unless explicitly archived/removed as a visible scope change.
- **Never mutate `goal_*` files.** Stop the upward walk at `initiative_*` and report `contributes_to` links read-only.
- **Respect `AGENTS.md` closeout rules:** validate, commit, rebase, and push any modified task/initiative files as part of task closeout.
