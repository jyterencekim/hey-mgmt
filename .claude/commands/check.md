Quick progress check. Show current status, what's next, and any blockers.

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond and generate all output in this language.


This is an **informational-only** command — it reads state but never executes work or modifies files.

Run these steps in order:

1. Read the member identity from `.env` (the `MEMBER` variable). If not set, ask the user for their name.

2. Gather current state (run in parallel where possible):

   **a) In-flight work:**
   ```bash
   ./hey work current
   ```

   **b) Task queue — ready and blocked:**
   ```bash
   ./hey search "" --type task --status ready --owner $MEMBER
   ./hey search "" --type task --status blocked --owner $MEMBER
   ```

   **c) Inbox — incoming items from teammates:**
   ```bash
   ./hey inbox list --workspace $MEMBER
   ```
   Filter for items where `kind` is `"member-send"` and `status` is `"open"`.

   **d) Today's daily log** at `workspace/$MEMBER/logs/YYYY-MM-DD.md` — scan for open threads, blockers, or the morning plan.

   **e) Today's commits** in this repo:
   ```bash
   git log --oneline --since="midnight"
   ```

   **f) Survey all working repos** for today's activity (run both in parallel):
   ```bash
   bash scripts/repo-survey.sh $MEMBER
   bash scripts/gh-survey.sh $MEMBER --since 1
   ```
   `repo-survey.sh` scans local clones (commits, staged, uncommitted changes since midnight). `gh-survey.sh` queries GitHub for open PRs, recently merged PRs, and open issues authored by/assigned to the member. Together they give the full picture: local work + GitHub state.

3. Present a **Status Check** in this format:

   ```markdown
   **Status Check — HH:MM KST**

   **Now**: [What you're currently working on, from in-flight task. "Nothing claimed" if idle.]

   **Done today** (N commits in this repo, M across all repos)
   - [One-line per commit in this repo, or "Nothing yet" if empty]

   **Repo activity** (from repo-survey)
   - [repo-name] (branch): N commits — [brief summary of work]
   - [repo-name]: uncommitted changes — [brief description]
   [Only show repos with activity. Omit section if no cross-repo activity.]

   **GitHub activity** (from gh-survey)
   - [repo-name]: N open PRs — [#number title, ...]
   - [repo-name]: N merged PRs (last 7d) — [brief summary]
   - [repo-name]: N open issues assigned
   [Only show repos with GitHub activity. Omit section if none.]

   **Incoming** (from teammates)
   - From [sender]: [title] (`inbox_id`) — [first line of body]

   **Up next**
   1. [Highest-priority unclaimed/ready task — title + one-line action]
   2. [Second priority, if any]

   **Blocked**
   - [Task title] — [reason]. [Suggested unblock action if obvious.]

   **Open threads**
   - [Anything from the daily log's open threads or unfinished items]
   ```

   Rules:
   - Omit any section that has nothing to report
   - Keep it scannable — one line per item
   - For "Up next", read the top candidate tasks to infer the concrete next action
   - If nothing is in-flight and candidates exist, nudge: *"Run `/more` to claim and start the top task."*
   - If everything is done, say so clearly
