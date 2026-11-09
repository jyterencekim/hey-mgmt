# AGENTS.md

`hey-mgmt` is a markdown-first team and personal operations repository. `./hey` is the reference CLI for the shared contract; the system of record is markdown + frontmatter + git. Agent identity and boundaries live in [`SOUL.md`](SOUL.md); core vs. optional architecture lives in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Style

Write per the style guides: English `content/playbooks/playbook_style-guide.md`, Korean `content/playbooks/playbook_style-guide.ko.md`. Capitalize normative keywords (MUST/SHOULD/MAY); use MUST for non-negotiable requirements. Conversational responses follow Interaction Tone below.

### Interaction Tone

All **member-facing** interactions MUST be encouraging, factually grounded, and include honest reminders (`content/playbooks/playbook_interaction-tone.md`):

- **Encouraging is not flattery:** Cite a concrete verifiable artifact (id, commit hash, timestamped log entry) for every positive framing. With nothing to cite, stay **neutral**; never manufacture positivity.
- **Recognition leads, reminders follow:** *"Here is what you actually did"* → *"here is what still wants your attention"*. Never invert.
- **Language & Tier:** Follow `LANGUAGE` from `.env` (artifacts stay in English unless the member writes in another language). Resolve tone tier via `HEY_TONE` in `.env` or `interaction_preference` in `content/vocab/members.yml` (`concise` / `terse` | `balanced` | `coaching` / `warm`, default `balanced`).
- **Exclusions:** Mechanical output (errors, SQL, file contents, validation/test/build logs); **adversarial surfaces** (critique rounds, architect/code/security reviews — kindness in a critique is specificity, not phrasing); commit messages and committed artifact bodies.

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
| `initiative` | `initiative` | `content/initiatives/` — Strategic effort coordinating tasks (`initiative` → `goal`; `decision_linear-ontology-adoption`) |
| `goal` | `goal` | `content/goals/` — Team/company-wide outcome; **HUMAN-SET ONLY** (`decision_adr-goal-as-seventh-type`) |

External reference docs live in `docs/references/`. Templates per type: `docs/TEMPLATES.md`.

### Frontmatter, Iteration Logs & CLI Reference

Every artifact requires `id`, `type`, `title`, `created_at`, `updated_at`, `status`, and `owner` (from `MEMBER` in `.env`, validated against `members.yml`). Optional core fields: `area` (`areas.yml`), `priority` (`do | plan | routine | drop`), `tags` (`tags.yml`), `entities` (`entities.yml`), `relations`, `sources`, `due_date`, `iteration`, `watchers`. Extension fields MUST use `x_*`.

Team iteration logs (`note` with `tags: [IterationLog]`, `x_iteration: YYYY-WNN`) sit upstream of ceremonies: `/iteration-open` scaffolds, `/iteration-add` appends, `/iteration-close` generates retrospective/carry-forward, `/morning` reads goals, and `/sync` opens/closes at week boundaries.

```bash
./hey validate                                                    # check all artifacts and schemas
./hey new --type <type> --title "..." --area Core --owner $MEMBER # scaffold artifact (tasks default to status: ready)
./hey new --workspace $MEMBER --type note --title "Daily standup" # scaffold workspace artifact
./hey task list [--status ready] [--area Core]                    # list tasks
./hey search "query"                                              # search artifacts
./hey deps check "<intent>"                                       # check change-impact contracts
./hey index build && ./hey db build                               # rebuild indexes and SQLite catalog
./hey graph <build|guidance|context|export>                       # knowledge graph operations
./hey loop <brief|board|horizon|digest>                           # loop control surfaces
./hey work <candidates|claim --next|complete --task ID|fail --task ID --reason "..."|status|runs>
```

## Notifications & Domain Routing

`./hey inbox send --to <member> --title "..." [--body "..."] [--task <taskId>]` (sender auto-detected from `MEMBER` in `.env`; lands in `workspace/{to}/inbox/` as `kind: "member-send"`).

**Send automatically** (no explicit user request needed):
- Member says "send this to X" / "delegate to X" / "notify X" → send immediately.
- Task created with `--owner != $MEMBER` → notify the new owner.
- Work falls outside current member's domain (`workspace/$MEMBER/profile.md` & `content/vocab/members.yml`) → flag and send to domain owner.
- Blocker requires another member's action → send with blocker context.
- Canonical `meeting` artifact created or imported → after writing final content, MUST run `./hey meeting notify <meeting-id-or-path>` so all internal members in `content/vocab/members.yml` receive an inbox item (automated imports and `content-edit-post.sh` invoke this with ledger deduplication).

**Do NOT send** for routine status updates, to a recipient who already owns the task and is aware, or to duplicate the iteration log (does not suppress the all-team notification for new meetings). Recipients triage via `./hey inbox <list|promote|discard>`.

## Core Rules & Session Workflows

1. **Portable Core (`ARCH1–3`, `OP1`):** Edit only `content/` and `workspace/`. Keep artifacts working as plain markdown + frontmatter + git with no runtime dependency, and prefix non-core fields with `x_*`.
2. **Member Identity:** Resolve `MEMBER` and `LANGUAGE` from `.env` (if `.env` is missing, tell the user to run `/setup`). Never hardcode a default owner.
3. **Validation & Principles (`GP1–7`, `OP2–4`):** Use shared vocabulary from `content/vocab/` (`GP2`, `GP7`), back decision-grade claims with `sources` (`GP1`, `GP6`), run `./hey search` before creating to avoid duplicates (`GP3`), keep one weekly-sized concern per artifact (`GP4`, `OP2`), link via `relations` (`GP5`), route raw unstructured intake through `inbox/` while creating explicit user-requested artifacts via `./hey new` (`OP3`), and finish every artifact change with `./hey validate`. (Consult `.claude/skills/mgmt-principles/SKILL.md`, `playbook_golden-principles`, `playbook_operating-philosophy`, or `ARCHITECTURE.md` when ambiguous; document unresolvable gaps with `<!-- PRINCIPLE GAP: ... -->`.)
4. **Task Status & Tree Hygiene:** Keep task/initiative statuses current and walk the connected tree whenever a tracked task changes status — see [Task Status Hygiene](#task-status-hygiene).
5. **Explanatory Integrity:** Close every substantive response (coding, writing, ops, analysis, planning) with a 2–4 sentence plain-language summary (`**👵 옆집 할머니도 알아들을 수 있게 요약**` or `**👵 Plain-Language Summary**`) explaining what happened, why it mattered, and what constraint or trade-off remains for an intelligent non-specialist — translating jargon into real-world cause-and-effect without childish ELI7 metaphors or oversimplification. Skip only for one-line acknowledgments, raw command/SQL dumps without narrative, or trivial yes/no answers (`.claude/skills/explanatory-integrity/SKILL.md`).

### Session Start

1. **Resolve identity & memory:** Read `MEMBER` (and `LANGUAGE`) from `.env`. Load `workspace/$MEMBER/memory/MEMORY.md` when repo, operational, or historical context is needed.
2. **Inbox & hard-deadline overdue triage (ceremony / task / planning contexts):** Before running any ceremony/planning skill (`/morning`, `/snap`, `/whatnext`, `/standup`, `/check`, `/sync`) or task/work-management execution — **skip for self-contained Q&A, code/doc review, or single-file analysis**:
   - **Check inbox:** If not already surfaced by `inbox-check.sh`, run `./hey inbox list --workspace $MEMBER`; if open items exist, show count/titles and ask to review, respond, or discard.
   - **Triage hard-deadline overdues:** `due_date` is reserved for hard external deadlines (`decision_adr-three-layer-task-timeline`); internal scheduling uses `iteration` / `x_planned_date` / `x_target_date`. Query:
     `./hey db query "SELECT id, title, priority, due_date FROM items WHERE type='task' AND owner='$MEMBER' AND status IN ('ready','doing','blocked') AND due_date < '$TODAY' ORDER BY due_date ASC"`
     Require one action per item (`defer YYYY-MM-DD` | `done` | `archive` | `drop` `due_date`) and update immediately; if empty, proceed silently.

### Retrieval Requests

When a request requires searching prior repo, git, or external context ("find", "look up", "what was", "link me", "previous", "recent", "찾아봐", "뭐였지", "링크 줘", "저번주"), follow `content/playbooks/playbook_retrieval-protocol.md` (RP1–RP5): collect ≥3 candidates, expand search terms, disconfirm the top candidate with ≥2 searches, and include a compressed `Retrieval proof:` (or `Sources checked:`) block. Never fabricate citations from memory when search returns 0 results.
- **Exact-target exception:** If the user supplies an exact file path or artifact ID to read, summarize, or edit, inspect it directly and **skip** candidate generation and disconfirmation.

### Task Display

On member-facing surfaces (plans, ceremonies, search summaries, inbox listings, Slack blocks, conversational responses), **lead with the task `title`, not the `id` or filename** — e.g. `Fix webhook retry backoff (\`task_fix-webhook-retry-backoff\`, \`do\`, due 2026-11-15)` (`decision_adr-display-task-titles-not-ids`). Excludes mechanical CLI output, frontmatter `relations`, and commit messages.

### Conversation Detection (ideas, promotions, tasks)

In free conversation (suppress during `/morning`, `/night`, `/snap`, `/sync`, `/standup`, `/clean`, `/check`, `/search`, `/whatnext`, `/task`, `/promote`), offer at most once without interrupting:
- **Idea (`/idea`):** Novel insight, risk, strategy, recurring theme, or decision framework → `workspace/$MEMBER/ideas/`.
- **Promote (`/promote`):** "Share with the team", "this should be a decision/playbook/task/note", directive policy framing → promote to `content/` (`decision_ideas-and-promote-workflow`).
- **Task (`/task`):** Only when both explicit commitment ("I'll…", "we need to…") and specific deliverable/scope/deadline are present.

### Goal Authoring

Goals (`content/goals/goal_*.md`) are **HUMAN-SET** (`decision_adr-goal-as-seventh-type`). Agents MUST NOT create, edit, or `/promote` goal artifacts. Agents MAY draft goal text in conversation on explicit request and propose `contributes_to` (initiative → goal) links for human confirmation.

### Dependency Checks

Before executing or proposing an execution plan for **substantive cross-component, contract, schema, manifest, config, or deployment changes** (skip for local doc formatting, typos, or early brainstorming), run `./hey deps check "<intent>"` and surface all resulting obligations (`ChangeImpact` / `x_change_contract`, `decision_adr-kb-wide-change-contracts`). Relay any degraded-recall notice (qmd absent/failed) explicitly.

### Git Worktrees, Commit Hygiene, and Codex Closeout

Full procedure graph & pitfalls: `content/playbooks/playbook_agent-commit-and-shell-hygiene.md`. Agents (including **Codex Closeout**) MUST NOT leave completed execution work as an uncommitted diff, an unmerged deploy branch, a stale local base branch, or an orphaned worktree:

1. **Validate & Commit Scoped Files:** Run `./hey validate` (or the target repo's validation suite). Stage only changed files by name (`git add <files>`; never `git add -A` on a shared checkout) and commit. *(In Claude Code, `.claude/settings.json` hooks auto-pull, auto-commit, push, and run `./hey validate` on `content/` and `workspace/` edits and `./hey` mutations; do not manually wrap those in git commands unless a hook fails or you are editing outside `content/` and `workspace/`. In Codex or non-hook sessions, commit and push explicitly.)*
2. **Guarded Stash, Rebase & Push:** Before `git pull --rebase origin <branch>`, if unrelated dirty files exist, run `git stash` and pop **only** if it printed `Saved working directory`; then `git push`. On conflict, inspect the diff first — never blindly `--theirs`/`--ours`.
3. **Worktree Isolation & Post-Deploy Cleanup:** Use the primary checkout for `hey-mgmt` unless isolation is needed; for other repos, create a worktree from freshly fetched `origin/<base>` (use `git -C <path>` rather than chaining `cd <worktree>`). After deployment/verification, merge back to `develop`/`main`, sync the local primary checkout (`0 ahead / 0 behind`), remove completed worktrees/branches (`git worktree remove`, `git worktree prune`, `git branch -d`), confirm via `git worktree list` and `git status -sb`, and report the commit hash and cleanup state (or state any blocker/exception and remaining local state).

## Work Management

### Initiative Kickoff, Task Scope, and Weekly Hygiene (always on)

Whenever creating, updating, activating, closing, or reporting on initiatives and their tasks, read and enforce `content/playbooks/playbook_product-initiative-kickoff.md` and `content/decisions/decision_adr-product-initiative-kickoff.md` (D1–D6):
- **Classify (`D1`):** Set `x_initiative_kind: product | business | marketing | ops` (never infer `product`).
- **Kickoff gate (`D2`) & Component tasks (`D3`):** A `product` initiative starts in `plan` and requires `x_timeline_start`, `x_timeline_end`, `x_prd_doc`, `x_components`, `x_kickoff_date`, and `x_baseline_tasks` (`./hey initiative kickoff <id>`) before becoming `active` (never invent missing values). Child tasks require `child_of`, `x_component`, `x_start_date`, and `x_target_date` (estimated finish; `due_date` is for hard external commitments only).
- **Baseline & Alerts (`D4–D6`):** Never overwrite `x_baseline_tasks`; surface scope diffs and gaps via `./hey initiative check | alert` and `./hey validate`.

### Task Lifecycle, Prioritization, and Status Hygiene

| Status | Meaning | Priority (`priority`) | Eisenhower Quadrant (`decision_adr-replace-p0-p3-priority-wit`) |
| --- | --- | --- | --- |
| `plan` | Backlog idea, not committed yet | `do` | **Important + Urgent** — act now (prod bug, critical outage) |
| `ready` | Committed and available to claim (`./hey new` default) | `plan` | **Important + Not Urgent** — schedule (architecture, docs) |
| `blocked` | Waiting on dependency (`relations: [{type: blocked_by, target: ...}]`) | `routine` | **Not Important + Urgent** — do fast or automate (recurring reports, minor config) |
| `doing` | Explicitly claimed and actively executing | `drop` | **Neither** — backlog or delete |
| `done` / `archived` | Finished / No longer relevant (with reason) | — | If ambiguous, **ask the user**. Fix retired `p0–p3` on sight (`p0→do`, `p1/p2→plan`, `p3→drop`). |

Non-task artifacts (`note`, `playbook`, `decision`, `meeting`, `initiative`, `goal`) use `status: active` to mean "in force" (`decision_adr-task-status-ready-doing`). Dispatch config lives in `WORKFLOW.md`.

### Task Status Hygiene

When advancing task-relevant work, follow `.claude/skills/update-task-tree/SKILL.md`:
1. **Transition immediately & bump `updated_at`:** Ad-hoc requests do not require a task, but if a tracked task exists, name its id and transition status at the moment of change (`ready → doing → done/blocked/archived`). Verify every `definition_of_done` criterion before marking `done`.
2. **Walk the connected tree (`update-task-tree`, always on):** Unblock downstream `blocked` tasks when blockers finish (notify owner via `./hey inbox send` if `owner != $MEMBER`), archive superseded tasks, transition parent `initiative` to `done` when all required baseline + scope-added tasks and initiative DoD are complete (never mutate `goal_*`), run `./hey validate`, and include a `🌳 Task Tree Update` summary leading with titles.

## Slash Commands Reference

| Command | Purpose |
| --- | --- |
| `/setup` · `/upgrade` | First-time member onboarding · Bring checkout up to latest repo capabilities (`./hey upgrade`) |
| `/morning` · `/night` · `/snap` | Start-of-day plan · End-of-day wrap-up · Save progress checkpoint to today's worklog |
| `/sync` · `/standup` · `/check` | Weekly iteration ceremony · Daily standup note · Quick mid-day status + inbox check |
| `/whatnext` · `/review-roadmap` | Staged prioritization for next task · Review active goals, initiatives, and task progress |
| `/task` · `/task-status` · `/clean` | Create task · Audit/update task statuses · Archive done tasks and compact old logs |
| `/idea` · `/promote` · `/decide` | Capture raw idea (`workspace/$MEMBER/ideas/`) · Promote to `content/` · Draft an ADR (`decision`) |
| `/assess` · `/search` · `/validate` | Evaluate external event/proposal · Search artifacts · Run `./hey validate` + principles check |
| `/weekly-report` · `/launch-frontend` | Generate weekly team executive digest · Launch local management board UI (`apps/board` + `apps/api`) |
