# AGENTS.md

`hey-mgmt` is a markdown-first team and personal operations repo. Markdown + frontmatter + git is the system of record; `./hey` is the CLI. Agent identity and boundaries live in [`SOUL.md`](SOUL.md); core vs. optional architecture lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Style

Follow the style guides: English `content/playbooks/playbook_style-guide.md`, Korean `content/playbooks/playbook_style-guide.ko.md`. Use short sentences and active voice. Capitalize policy keywords (MUST/SHOULD/MAY); use MUST for hard requirements. Conversational replies follow Interaction Tone below.

### Interaction Tone

All **member-facing** replies MUST be encouraging, fact-based, and include honest reminders (`content/playbooks/playbook_interaction-tone.md`):

- **Encouraging is not flattery:** Cite a concrete artifact (id, commit hash, or log entry) for every positive point. If there is nothing to cite, stay **neutral** — never invent praise.
- **Recognition leads, reminders follow:** State what the member accomplished first, then what still needs attention. Never invert this order.
- **Language & Tier:** Follow `LANGUAGE` from `.env` (artifacts stay in English unless the member writes in another language). Resolve tone tier via `HEY_TONE` in `.env` or `interaction_preference` in `content/vocab/members.yml` (`concise` / `terse` | `balanced` | `coaching` / `warm`, default `balanced`).
- **Exclusions:** Mechanical output (errors, SQL, file contents, test/build logs); critiques and architect/code/security reviews (be direct and specific); commit messages and artifact bodies.

## Repository Structure & Artifact Model

### Source of Truth & Workspaces

Only `content/` and `workspace/` are canonical. Never hand-edit derived or runtime directories:

| Path | Role | Editable? |
| --- | --- | --- |
| `content/` | Shared artifacts and vocab registries (`content/vocab/{members,areas,repos,tags,entities}.yml`) | Yes |
| `workspace/{name}/` | Personal artifacts, `memory/MEMORY.md`, `inbox/` (raw intake queue), `.omc/` (gitignored agent context) | Yes |
| `workspace/fisher/` | Agent runtime (collectors, bot) | Yes |
| `index/` · `.hey/` · `.runtime/` | Derived indexes (`./hey index build`), SQLite DB (`./hey db build`), local connector state | No |

### 7 Artifact Types & Placement

| Type | Prefix | Placement & Use |
| --- | --- | --- |
| `task` | `task` | `content/tasks/` — Work to do (`task` → `initiative`) |
| `decision` | `decision` | `content/decisions/` — Why we chose X over Y, or proposals (`decision_status: proposed → accepted`) |
| `meeting` | `meeting` | `content/meetings/` — Notes + action items |
| `playbook` | `playbook` | `content/playbooks/` — How to do X (runbook) |
| `note` | `note` | `content/notes/` — Specs, findings, alerts, reports, ideas, weekly iteration logs (`tags: [IterationLog]`, `x_iteration: YYYY-WNN`), change contracts (`content/notes/dependencies/`) |
| `initiative` | `initiative` | `content/initiatives/` — Strategic effort grouping tasks (`initiative` → `goal`; `decision_linear-ontology-adoption`) |
| `goal` | `goal` | `content/goals/` — Team/company-wide outcome; **HUMAN-SET ONLY** (`decision_adr-goal-as-seventh-type`) |

External reference docs live in `docs/references/`. Templates per type: `docs/TEMPLATES.md`.

### Frontmatter, Iteration Logs & CLI Reference

Every artifact requires `id`, `type`, `title`, `created_at`, `updated_at`, `status`, and `owner` (from `MEMBER` in `.env`, checked against `members.yml`). Optional core fields: `area` (`areas.yml`), `priority` (`do | plan | routine | drop`), `tags` (`tags.yml`), `entities` (`entities.yml`), `relations`, `sources`, `due_date`, `iteration`, `watchers`. Custom fields MUST use `x_*`.

Weekly iteration logs (`note` with `tags: [IterationLog]`, `x_iteration: YYYY-WNN`) drive team ceremonies: `/iteration-open` creates the log, `/iteration-add` appends entries, `/iteration-close` writes the retro and carry-over, `/morning` reads weekly goals, and `/sync` rotates weeks.

```bash
./hey validate                                                    # check all artifacts and schemas
./hey new --type <type> --title "..." --area Core --owner $MEMBER # create artifact (tasks default to status: ready)
./hey new --workspace $MEMBER --type note --title "Daily standup" # create workspace artifact
./hey task list [--status ready] [--area Core]                    # list tasks
./hey search "query"                                              # search artifacts
./hey deps check "<intent>"                                       # check change-impact contracts
./hey index build && ./hey db build                               # rebuild indexes and SQLite DB
./hey graph <build|guidance|context|export>                       # knowledge graph commands
./hey loop <brief|board|horizon|digest>                           # loop control views
./hey work <candidates|claim --next|complete --task ID|fail --task ID --reason "..."|status|runs>
```

## Notifications & Domain Routing

`./hey inbox send --to <member> --title "..." [--body "..."] [--task <taskId>]` (sender is `MEMBER` from `.env`; writes to `workspace/{to}/inbox/` as `kind: "member-send"`).

**Send automatically** (without waiting to be asked):
- Member says "send this to X" / "delegate to X" / "notify X" → send right away.
- Task created with `--owner != $MEMBER` → notify the new owner.
- Work falls outside the current member's domain (`workspace/$MEMBER/profile.md` & `content/vocab/members.yml`) → flag and send to the domain owner.
- A blocker needs another member's action → send with blocker details.
- New or imported `meeting` in `content/meetings/` → MUST run `./hey meeting notify <meeting-id-or-path>` after writing final content so all internal members in `content/vocab/members.yml` receive an inbox item (hooks and importers deduplicate via ledger).

**Do NOT send** for routine status updates, to an owner who already knows, or to copy the iteration log (new meetings still notify all internal members). Recipients manage items with `./hey inbox <list|promote|discard>`.

## Core Rules & Session Workflows

1. **Portable Core (`ARCH1–3`, `OP1`):** Edit only `content/` and `workspace/`. Keep artifacts as plain markdown + frontmatter + git with no runtime lock-in, and prefix custom fields with `x_*`.
2. **Member Identity:** Read `MEMBER` and `LANGUAGE` from `.env` (if `.env` is missing, tell the user to run `/setup`). Never hardcode a default owner.
3. **Validation & Principles (`GP1–7`, `OP2–4`):** Use values from `content/vocab/` (`GP2`, `GP7`). Cite `sources` on decisions and claims (`GP1`, `GP6`). Run `./hey search` before creating to prevent duplicates (`GP3`). Keep one 1-week topic per artifact (`GP4`, `OP2`) and link related items via `relations` (`GP5`). Send raw external input to `inbox/`, but create user-requested artifacts directly with `./hey new` (`OP3`). Run `./hey validate` after every artifact change (see `.claude/skills/mgmt-principles/SKILL.md`, `playbook_golden-principles`, `playbook_operating-philosophy`, `ARCHITECTURE.md`; mark open gaps with `<!-- PRINCIPLE GAP: ... -->`).
4. **Task Status & Tree Hygiene:** Keep task and initiative statuses current, and update connected items whenever a task changes status — see [Task Status Hygiene](#task-status-hygiene).
5. **Explanatory Integrity:** End every non-trivial response with a 2–4 sentence plain-language summary (`**👵 옆집 할머니도 알아들을 수 있게 요약**` or `**👵 Plain-Language Summary**`). Explain what changed, why it matters, and what limit or trade-off remains for a smart non-specialist. Replace jargon with real cause-and-effect; avoid childish metaphors or oversimplification. Skip only for one-line replies, raw command/SQL output, or simple yes/no answers (`.claude/skills/explanatory-integrity/SKILL.md`).

### Session Start

1. **Identity & memory:** Read `MEMBER` and `LANGUAGE` from `.env`. Read `workspace/$MEMBER/memory/MEMORY.md` when repo or historical context is needed.
2. **Inbox & overdue deadlines (ceremony / task / planning only):** Run these before ceremony or planning skills (`/morning`, `/snap`, `/whatnext`, `/standup`, `/check`, `/sync`) or task management — **skip for standalone Q&A, code/doc review, or single-file analysis**:
   - **Inbox:** If `inbox-check.sh` has not already listed them, run `./hey inbox list --workspace $MEMBER`. If open items exist, show count and titles and ask whether to review, reply, or discard.
   - **Overdue hard deadlines:** `due_date` is for hard external deadlines only (`decision_adr-three-layer-task-timeline`); internal schedules use `iteration` / `x_planned_date` / `x_target_date`. Run:
     `./hey db query "SELECT id, title, priority, due_date FROM items WHERE type='task' AND owner='$MEMBER' AND status IN ('ready','doing','blocked') AND due_date < '$TODAY' ORDER BY due_date ASC"`
     Require one action per overdue task (`defer YYYY-MM-DD` | `done` | `archive` | `drop` `due_date`) and update files right away. If none, continue silently.

### Retrieval Requests

When a question requires finding past repo, git, or external context ("find", "look up", "what was", "link me", "previous", "recent", "찾아봐", "뭐였지", "링크 줘", "저번주"), follow `content/playbooks/playbook_retrieval-protocol.md` (RP1–RP5): gather ≥3 candidates, expand search terms, run ≥2 searches to test whether the top match could be wrong, and show a short `Retrieval proof:` (or `Sources checked:`) block. Never invent citations when search returns 0 results.
- **Exact-target exception:** When the user gives an exact file path or artifact ID to read, summarize, or edit, inspect it directly and **skip** candidate search and verification.

### Task Display

On member-facing surfaces (plans, ceremonies, search results, inbox lists, Slack blocks, chat replies), **show the task `title` first, not the `id` or filename** — e.g. `Fix webhook retry backoff (\`task_fix-webhook-retry-backoff\`, \`do\`, due 2026-11-15)` (`decision_adr-display-task-titles-not-ids`). Does not apply to raw CLI output, frontmatter `relations`, or commit messages.

### Conversation Detection (ideas, promotions, tasks)

In free conversation (disable during `/morning`, `/night`, `/snap`, `/sync`, `/standup`, `/clean`, `/check`, `/search`, `/whatnext`, `/task`, `/promote`), offer at most once without interrupting:
- **Idea (`/idea`):** New insight, risk, strategy, recurring theme, or decision rule → save to `workspace/$MEMBER/ideas/`.
- **Promote (`/promote`):** "Share with the team", "this should be a decision/playbook/task/note", or team policy statements → promote to `content/` (`decision_ideas-and-promote-workflow`).
- **Task (`/task`):** Offer only when there is both a clear commitment ("I'll…", "we need to…") and a specific deliverable or deadline.

### Goal Authoring

Goals (`content/goals/goal_*.md`) are **HUMAN-SET** (`decision_adr-goal-as-seventh-type`). Agents MUST NOT create, edit, or `/promote` goal files. Agents MAY draft goal text in chat when asked and suggest `contributes_to` (initiative → goal) links for human approval.

### Dependency Checks

Before planning or running **cross-component, contract, schema, manifest, config, or deploy changes** (skip for doc formatting, typos, or early brainstorming), run `./hey deps check "<intent>"` and list all resulting obligations (`ChangeImpact` / `x_change_contract`, `decision_adr-kb-wide-change-contracts`). If `deps check` warns that `qmd` is unavailable (degraded recall), include that warning in your reply.

### Git Worktrees, Commit Hygiene, and Codex Closeout

Full guide: `content/playbooks/playbook_agent-commit-and-shell-hygiene.md`. Agents (including **Codex Closeout**) MUST NOT leave finished work as an uncommitted diff, an unmerged branch, a stale local base branch, or a leftover worktree:

1. **Validate & Commit Scoped Files:** Run `./hey validate` (or the target repo's tests). Stage only your changed files by name (`git add <files>`; never `git add -A` on a shared checkout) and commit. *(In Claude Code, `.claude/settings.json` hooks auto-pull, auto-commit, push, and run `./hey validate` on `content/` and `workspace/` edits and `./hey` changes; do not wrap those in manual git commands unless a hook fails or you edit outside `content/` and `workspace/`. In Codex or non-hook sessions, commit and push manually.)*
2. **Guarded Stash, Rebase & Push:** Before `git pull --rebase origin <branch>`, if other dirty files exist, run `git stash` and pop **only** if it printed `Saved working directory`; then `git push`. On conflict, inspect the diff first — never blindly run `--theirs` or `--ours`.
3. **Worktree Isolation:** Use the primary checkout for `hey-mgmt` unless isolation is needed. For any other repo, create a worktree from freshly fetched `origin/<base>` (use `git -C <path>` instead of chaining `cd <worktree>`).
4. **Post-Deploy Sync & Cleanup:** After deployment or verification, merge back to `develop` or `main`. Sync the local primary checkout to `0 ahead / 0 behind`, remove finished worktrees and merged branches (`git worktree remove`, `git worktree prune`, `git branch -d`), check `git worktree list` and `git status -sb`, and report the commit hash and cleanup state (or list any blocker and remaining local files/branches/worktrees).

## Work Management

### Initiative Kickoff, Task Scope, and Weekly Hygiene (always on)

When creating, updating, starting, closing, or reporting on initiatives and their tasks, follow `content/playbooks/playbook_product-initiative-kickoff.md` and `content/decisions/decision_adr-product-initiative-kickoff.md` (D1–D6):
- **Classify (`D1`):** Set `x_initiative_kind: product | business | marketing | ops` (never guess `product`).
- **Kickoff gate (`D2`) & Component tasks (`D3`):** A `product` initiative starts in `plan` and needs `x_timeline_start`, `x_timeline_end`, `x_prd_doc`, `x_components`, `x_kickoff_date`, and `x_baseline_tasks` (`./hey initiative kickoff <id>`) before moving to `active` (never invent missing values). Child tasks need `child_of`, `x_component`, `x_start_date`, and `x_target_date` (planned finish; `due_date` is for hard external deadlines only).
- **Baseline & Alerts (`D4–D6`):** Never overwrite `x_baseline_tasks`. Check scope changes and missing fields with `./hey initiative check | alert` and `./hey validate`.

### Task Lifecycle, Prioritization, and Status Hygiene

| Status | Meaning | Priority (`priority`) | Eisenhower Quadrant (`decision_adr-replace-p0-p3-priority-wit`) |
| --- | --- | --- | --- |
| `plan` | Backlog idea, not committed yet | `do` | **Important + Urgent** — act now (prod bug, critical outage) |
| `ready` | Committed and ready to claim (`./hey new` default) | `plan` | **Important + Not Urgent** — schedule (architecture, docs) |
| `blocked` | Waiting on dependency (`relations: [{type: blocked_by, target: ...}]`) | `routine` | **Not Important + Urgent** — do fast or automate (recurring reports, minor config) |
| `doing` | Claimed and in progress | `drop` | **Neither** — backlog or delete |
| `done` / `archived` | Finished / Dropped (with reason) | — | If unclear, **ask the user**. Replace old `p0–p3` labels on sight (`p0→do`, `p1/p2→plan`, `p3→drop`). |

Non-task artifacts (`note`, `playbook`, `decision`, `meeting`, `initiative`, `goal`) use `status: active` to mean "in force" (`decision_adr-task-status-ready-doing`). Dispatch settings live in `WORKFLOW.md`.

### Task Status Hygiene

When advancing task work, follow `.claude/skills/update-task-tree/SKILL.md`:
1. **Update status right away & bump `updated_at`:** Ad-hoc work does not need a task, but if a task exists, cite its id and update its status immediately (`ready → doing → done/blocked/archived`). Check every `definition_of_done` item before marking `done`.
2. **Walk the connected tree (`update-task-tree`, always on):** Unblock `blocked` tasks to `ready` once all blockers finish (and run `./hey inbox send` if `owner != $MEMBER`). Archive replaced tasks. Mark a parent `initiative` as `done` when all baseline + scope-added tasks and the initiative's DoD are complete (never edit `goal_*`). Run `./hey validate` and include a `🌳 Task Tree Update` summary leading with titles.

## Slash Commands Reference

| Command | Purpose |
| --- | --- |
| `/setup` · `/upgrade` | First-time member setup · Upgrade checkout to latest capabilities (`./hey upgrade`) |
| `/morning` · `/night` · `/snap` | Start-of-day plan · End-of-day wrap-up · Save progress checkpoint to today's worklog |
| `/sync` · `/standup` · `/check` | Weekly iteration ceremony · Daily standup note · Quick mid-day status + inbox check |
| `/whatnext` · `/review-roadmap` | Pick next priority task · Review active goals, initiatives, and task progress |
| `/task` · `/task-status` · `/clean` | Create task · Audit/update task statuses · Archive done tasks and compact old logs |
| `/idea` · `/promote` · `/decide` | Save raw idea (`workspace/$MEMBER/ideas/`) · Promote to `content/` · Draft an ADR (`decision`) |
| `/assess` · `/search` · `/validate` | Evaluate external event/proposal · Search artifacts · Run `./hey validate` + principles check |
| `/weekly-report` · `/launch-frontend` | Generate weekly team digest · Launch local board UI (`apps/board` + `apps/api`) |
