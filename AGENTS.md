# AGENTS.md

`hey-mgmt` is a markdown-first team and personal operations repository. `./hey` is the reference CLI for the shared contract; the system of record is markdown + frontmatter + git.

## Style

Write per the style guides: English [`content/playbooks/playbook_style-guide.md`](content/playbooks/playbook_style-guide.md), Korean [`content/playbooks/playbook_style-guide.ko.md`](content/playbooks/playbook_style-guide.ko.md). Capitalize normative keywords (MUST/SHOULD/MAY) per the style guide; use MUST for non-negotiable requirements.

## Quick Start

```bash
./hey validate                                                # check all artifacts
./hey new --type task --title "My task" --area Core --owner $MEMBER
./hey task list --status ready                                # Ready tasks
```

## Types

7 artifact types. That's it.

| Type | Prefix | Use for |
|------|--------|---------|
| `task` | `task` | Work to do |
| `decision` | `decision` | Why we chose X over Y — or proposals awaiting input (`decision_status: proposed → accepted`) |
| `meeting` | `meeting` | Notes + action items |
| `playbook` | `playbook` | How to do X (runbook) |
| `note` | `note` | Everything else (findings, alerts, reports, ideas, iteration logs, change contracts) |
| `initiative` | `initiative` | A strategic effort coordinating many tasks (`task` → `initiative`) — see [`decision_linear-ontology-adoption`](content/decisions/decision_linear-ontology-adoption.md) |
| `goal` | `goal` | A team/company-wide outcome initiatives contribute to (`initiative` → `goal`); **human-set only** — see [`decision_adr-goal-as-seventh-type`](content/decisions/decision_adr-goal-as-seventh-type.md) |

## Registries

| File | Validates |
|------|-----------|
| `content/vocab/members.yml` | `owner`, `owners`, `attendees`, `watchers` fields |
| `content/vocab/areas.yml` | `area` fields |
| `content/vocab/repos.yml` | `repos` in dependency contracts and missions |
| `content/vocab/tags.yml` | `tags` values |
| `content/vocab/entities.yml` | `entities` names |

## Workspaces

Each member has a workspace under `workspace/{name}/` for worklogs, notes, inbox, and progress. Workspace artifacts use the same types and frontmatter as root content, link to root artifacts via `[[id]]` wiki-links, and auto-set `owner` to the workspace member.

```bash
./hey new --workspace alice --type note --title "Daily standup"
```

| Path | Purpose |
|------|---------|
| `workspace/{name}/` | Personal artifacts |
| `workspace/{name}/inbox/` | Raw intake queue before promotion |
| `workspace/{name}/.omc/` | Agent context (gitignored) |

## Knowledge Placement

| What you have | Where it goes | Example |
|---------------|---------------|---------|
| Project spec, finding, idea | `content/notes/` | `note_auth-session-strategy.md` |
| Team iteration log | `content/notes/` | `note_iteration-log-2026-w45.md` |
| Cross-repo change contract | `content/notes/dependencies/` | `note_api-schema-contract.md` |
| Runbook, how-to | `content/playbooks/` | `playbook_release-checklist.md` |
| External reference doc | `docs/references/` | `external-api-llms.txt` |
| Team decision rationale | `content/decisions/` | `decision_auth-provider.md` |

No separate knowledge-base dir — route project knowledge through `content/` for validation, search, and cross-linking.

## Creating Artifacts

Agents: `./hey new --type <type> --title "..." [--area X] [--owner Y] [--field key=value]`. Humans: `./hey task new` (interactive). Templates showing expected frontmatter and body per type: [`docs/TEMPLATES.md`](docs/TEMPLATES.md) — consult before creating artifacts manually; `./hey new` scaffolds the structure automatically.

## Source of Truth

Only `content/` and `workspace/` are canonical. Everything else is derived or optional local runtime:

| Path | Role | Editable? |
|------|------|-----------|
| `content/` | Shared artifacts | Yes |
| `workspace/{name}/` | Personal artifacts | Yes |
| `workspace/fisher/` | Agent runtime (collectors, bot) | Yes |
| `index/` | Derived indexes | No (`./hey index build`) |
| `.hey/` | Local runtime state | No (`./hey db build`) |
| `.runtime/` | Local connector state | No |

## CLI Reference

| Command | Purpose |
|---------|---------|
| `./hey validate` | Check all artifacts |
| `./hey new --type T --title "..."` | Create any artifact |
| `./hey task new` | Interactive task creation |
| `./hey task list [--status S]` | List tasks |
| `./hey search "query"` | Search artifacts |
| `./hey deps check "<intent>"` | Check change-impact contracts before modifying systems |
| `./hey index build` | Rebuild indexes |
| `./hey db build` | Build SQLite catalog |
| `./hey graph <subcommand>` | Knowledge graph operations (`build`, `guidance`, `context`, `export`) |
| `./hey loop <subcommand>` | Loop control (`brief`, `board`, `horizon`, `digest`) |
| `./hey stats` | Artifact counts |

## Frontmatter

Every artifact has:

```yaml
id: task_my-task-name      # auto-generated from title
type: task                 # one of the 7 types
title: Fix webhook retry
created_at: 2026-11-05
updated_at: 2026-11-05
status: ready              # Ready to claim, not in progress (task lifecycle; see decision_adr-task-status-ready-doing)
owner: <member>            # resolved from .env MEMBER variable (e.g. alice)
```

Optional: `area`, `priority` (`do | plan | routine | drop`), `tags`, `entities`, `relations`, `sources`, `due_date`, `iteration`, `watchers`. Extension-only fields MUST use the `x_*` namespace so optional modules do not contaminate the portable core.

### Iteration Logs

Team-level iteration logs are `note` artifacts with `tags: [IterationLog]` and `x_iteration: YYYY-WNN`, tracking team goals, milestones, blockers, decisions, and coordination for the week. `/iteration-open` scaffolds one at week start, `/iteration-add` appends categorized entries, `/iteration-close` generates the retrospective and carry-forward items. The iteration log is **upstream** of member-level ceremonies: `/morning` reads goals from it; `/sync` opens and closes it at iteration boundaries.

## Notifications

When work needs another member's attention:

```bash
./hey inbox send --to <member> --title "..." [--body "..."] [--task <taskId>]
```

The sender is auto-detected from `$MEMBER` in `.env`; the item lands in `workspace/{to}/inbox/` (`kind: "member-send"`) and surfaces during the recipient's `/morning` and `/check`.

**Send automatically** (no explicit user request needed):

| Signal | Action |
|--------|--------|
| Member says "send this to X" / "delegate to X" / "notify X" | Send immediately |
| Task created with `--owner` different from `$MEMBER` | Notify the new owner |
| Work falls outside current member's domain (check `workspace/$MEMBER/profile.md`) | Send to the domain owner |
| A blocker requires another member's action | Send with the blocker context |
| A canonical `meeting` artifact is created or imported | After the final meeting content is written, MUST run `./hey meeting notify <meeting-id-or-path>` so all internal members in `content/vocab/members.yml` receive an inbox item asking them to read it. |

**Do NOT send** for routine status updates, to a recipient who already owns the task and is aware, or to duplicate the iteration log. This exception does not suppress the all-team notification for a newly registered meeting artifact. Recipients handle items via `./hey inbox list`, `./hey inbox promote`, or `./hey inbox discard`.

## Rules

1. Agents MUST edit only `content/` and `workspace/`. Never hand-edit `index/` or `.hey/`.
2. Agents MUST run `./hey validate` before committing.
3. Use names from `members.yml` for owners and `areas.yml` for areas.
4. Back decision-grade claims with `sources`.
5. Agents MUST keep task statuses current — see [Task Status Hygiene](#task-status-hygiene).
6. Agents MUST resolve the active human member's identity from `.env` (the `MEMBER` variable) for task creation, workspace operations, and owner attribution. Never assume a hardcoded default owner.
7. Agents MUST follow the Explanatory Integrity rule on every substantive response, in any domain (code, writing, ops, analysis, planning): close the response with a plain-language summary ("👵 옆집 할머니도 알아들을 수 있게 요약" / "👵 Plain-Language Summary") in 2–4 sentences that explains what happened, why it mattered, and what constraint or trade-off remains for an intelligent non-specialist — replacing jargon with real-world cause-and-effect while avoiding childish ELI7 metaphors or oversimplification. Full rules: `.claude/skills/explanatory-integrity/SKILL.md`.

### Git Worktrees

- Use the primary checkout for `hey-mgmt` work; create a worktree only on user request or when concurrent work requires isolation.
- When work leads to changes in another repository, agents MUST use a worktree owned by that target repo, created from the latest remote-tracking commit of the intended base branch (fetch first; never base on a stale local branch). Keep that repo's edits, validation, commits, and pushes inside its worktree.
- Once deployment or delivery is verified, agents MUST run the final closeout step: merge the deployed changes back into the target repository's primary integration/release branch (`develop` or `main`, per repo convention), sync the local primary checkout with the remote base branch (`git fetch origin` and fast-forward/pull so local `main`/`develop` matches `origin/main` or `origin/develop` with zero ahead/behind), and clean up all completed worktrees and merged branches (`git worktree remove`, `git worktree prune`, `git branch -d`).

## Dependency Checks

Agents MUST run `./hey deps check "<intent>"` before proposing or executing change-intent work, and MUST surface the resulting obligations explicitly in responses. Applies to update/change/deploy/migrate/rename/remove/integrate/refactor (and Korean equivalents).

qmd semantic recall is the **primary recall channel** for this gate ([`decision_adr-kb-wide-change-contracts`](content/decisions/decision_adr-kb-wide-change-contracts.md)). When `deps check` prints a degraded-recall notice (qmd absent/failed), agents MUST relay that notice alongside the results rather than presenting structured+lexical output as full coverage. Contracts are KB-wide: any content artifact tagged `ChangeImpact` with `x_change_contract` binds obligations, not just notes under `content/notes/dependencies/`.

## Principles Review

Every agent that creates or modifies artifacts MUST run a self-review against three principle sets before declaring work complete. Read the sources first:

| Principle Set            | Source                                                 | Key Question                                    |
|--------------------------|--------------------------------------------------------|-------------------------------------------------|
| Golden Principles (7)    | `content/playbooks/playbook_golden-principles.md`      | Does this output keep the knowledge base clean? |
| Operating Philosophy (4) | `content/playbooks/playbook_operating-philosophy.md`   | Does this output serve how the team works?      |
| Architecture Constraints | `ARCHITECTURE.md`                                      | Does this output respect the portable core?     |

For each artifact created or modified, verify:

- [ ] **GP1 — No Unattributed Claims**: decision-grade artifacts have `sources`; unevidenced claims become a `note` with hypothesis tag.
- [ ] **GP2 — Shared Vocabulary**: all `tags`, `entities`, `owner`, `area` values come from `content/vocab/`.
- [ ] **GP3 — Freshness**: not duplicating or contradicting existing artifacts (`./hey search` first).
- [ ] **GP4 — One Concern**: one topic per artifact; split if it grew beyond 3 acceptance criteria.
- [ ] **GP5 — Relations Over Duplication**: link via `relations` instead of copying.
- [ ] **GP6 — Sources Chain**: tasks link to authorizing decisions and vice versa; the graph is navigable.
- [ ] **GP7 — Canonical Before Custom**: no invented vocabulary; reuse existing entities/tags.
- [ ] **OP1 — Shared Ledger**: plain markdown + frontmatter + git; no proprietary format or UI-dependent state.
- [ ] **OP2 — Fixed Cadence**: work fits a 1-week iteration or was split.
- [ ] **OP3 — Inbox-First**: raw input went through inbox triage, not straight into `content/`.
- [ ] **OP4 — Teaching Ourselves**: the artifact records a lesson or decision that improves how the team works.
- [ ] **ARCH1 — Portable Core**: only `content/` and `workspace/` edited.
- [ ] **ARCH2 — No Runtime Dependency**: the artifact works as plain markdown, no app/service required.
- [ ] **ARCH3 — Extension Namespace**: non-standard frontmatter fields use `x_*`.

Run the checklist after creating/modifying artifacts, and always finish with `./hey validate`. If a principle is violated, fix it before declaring work complete; if it cannot be fixed yet, document the gap in the artifact body (`<!-- PRINCIPLE GAP: GP1 — sources pending, needs team input -->`). Never silently skip a failing check.

## Work Management

### Initiative Kickoff, Task Scope, and Weekly Hygiene (always on)

See [`decision_adr-product-initiative-kickoff`](content/decisions/decision_adr-product-initiative-kickoff.md) and [`playbook_product-initiative-kickoff`](content/playbooks/playbook_product-initiative-kickoff.md). These rules apply whenever an agent creates, updates, activates, closes, or reports on initiatives and their tasks:

1. **Classify every initiative.** Agents MUST record `x_initiative_kind` as one of `product`, `business`, `marketing`, or `ops`. The product-specific requirements below MUST NOT be imposed on business, marketing, or ops initiatives. Missing kind is missing information, not permission to infer `product`.
2. **Gate product kickoff.** A product initiative MUST NOT be set to `status: active` without a start date (`x_timeline_start`), an end date (`x_timeline_end`), a PRD link (`x_prd_doc`), the PRD's component list (`x_components`), a kickoff date (`x_kickoff_date`), and the task IDs agreed at kickoff (`x_baseline_tasks`). Use `./hey initiative kickoff <id>` after filling the PRD and dates.
3. **Keep tasks deliverable-sized.** Each task belonging to a product initiative MUST have a component (`x_component`), a start date (`x_start_date`), and a target date (`x_target_date`). The component MUST match the initiative's PRD component list. Small implementation steps belong inside that task's Definition of Done, not in separate tasks. Link tasks to their initiative with `child_of`.
4. **Separate targets from commitments.** `x_target_date` is an estimated completion target, NOT `due_date`. `due_date` remains reserved for hard external commitments under [`decision_adr-three-layer-task-timeline`](content/decisions/decision_adr-three-layer-task-timeline.md).
5. **Preserve the kickoff baseline and scope changes.** Keep `x_baseline_tasks` as the kickoff snapshot, compare it with the current linked task set, and show additions and removals separately in weekly reports.

### Task Lifecycle

```text
plan → ready → [claim] → doing → done
                      ↓
                   ready  (after fail)
```

| Status | Meaning |
|--------|---------|
| `plan` | Backlog idea, not committed yet |
| `ready` | Committed and available to claim; nobody working on it |
| `blocked` | Waiting on a dependency |
| `doing` | Explicitly claimed and actively executing |
| `done` | Finished |
| `archived` | No longer relevant |

Renames per [`decision_adr-task-status-ready-doing`](content/decisions/decision_adr-task-status-ready-doing.md): `active` → `ready`, `in_progress` → `doing`. Non-task artifacts (notes, playbooks, decisions, meetings, initiatives, goals) still use `status: active` to mean "in force".

### Task Status Hygiene

When working on or advancing task-relevant work, agents MUST:

1. **Name the task id** if the current work advances a tracked task.
2. **Transition status at the moment of change**, never batched to session end: picking up a `ready` task → `doing`; hitting a blocking dependency → `blocked`; Definition of Done satisfied → `done`; decided not to ship → `archived` with a one-line reason.
3. **Bump `updated_at`** on every status change.
4. **Verify before declaring done**: re-read `definition_of_done` and confirm each criterion; surface anything unverifiable rather than marking `done`.
5. **Sweep at session end**: confirm every task advanced this session has an accurate status.

### Creating & Working on Tasks

```bash
# For humans (defaults to $MEMBER from .env if omitted)
./hey new --type task --title "Fix webhook fallback" --owner $MEMBER --area Core

# For agent (auto-dispatched when owner=agent)
./hey new --type task --title "Add retry logic" --owner agent --priority plan

# Work runner
./hey work candidates            # see what's available
./hey work claim --next          # claim top priority
./hey work complete --task <id>  # done → pushes branch, opens draft PR
./hey work fail --task <id> --reason "Blocked on API spec"
./hey work status                # current claims
```
