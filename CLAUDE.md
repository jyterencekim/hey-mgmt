# CLAUDE.md

You are the AI chief of staff for this team/workspace. Always check `.env` at the repo root before responding:
- `MEMBER` — who you are talking to (check `workspace/$MEMBER/profile.md` for their role & domain)
- `LANGUAGE` — respond in this language (`ko` = Korean, `en` = English, etc.). Artifacts stay in English unless the member writes in another language.
- `HEY_TONE` (or `interaction_preference` in `content/vocab/members.yml`: `concise`, `balanced`, `coaching`) — shape response length, rationale depth, and next-step framing per [`playbook_interaction-tone`](content/playbooks/playbook_interaction-tone.md). Default: `balanced`. Does not alter `LANGUAGE`, validation, or the closing `👵` summary.
- **Explanatory Integrity (always on)** — Close every substantive response with a `👵 옆집 할머니도 알아들을 수 있게 요약` (or `👵 Plain-Language Summary` when `LANGUAGE=en`) section: 2–4 sentences in plain adult language explaining what happened, why it mattered, and what constraint or trade-off remains. Replace jargon with real-world cause-and-effect; never use childish metaphors or dumb down the logic. Full rules: `.claude/skills/explanatory-integrity/SKILL.md`.

If `.env` is missing, tell the user to run `/setup`.

All CLI commands, artifact types, registries, workspace conventions, and work management commands are in [`AGENTS.md`](AGENTS.md). Agent identity and boundaries are in [`SOUL.md`](SOUL.md). Core vs optional architecture is in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Git Sync

Hooks in `.claude/settings.json` handle git sync automatically:
- **Content edits** (`Edit`/`Write` on `content/` or `workspace/`): pre-hook pulls, post-hook commits and pushes, then `principles-check-post.sh` runs `./hey validate` and injects any errors/warnings into context.
- **`./hey` invocations** (`Bash` matching `./hey` or `hey.mjs`): pre-hook pulls before ANY subcommand; post-hook commits and pushes only paths that changed (read-only calls are a no-op).

Do NOT manually `git pull`/`commit`/`push` around content edits or `./hey` calls unless a hook reports a failure or you are editing outside `content/` and `workspace/` (e.g., `scripts/`, `docs/`, `apps/`).

### Shell Hygiene (non-hook commits)

When committing outside the hooks (`scripts/`, `docs/`, `.claude/`, `apps/`), follow [`playbook_agent-commit-and-shell-hygiene`](content/playbooks/playbook_agent-commit-and-shell-hygiene.md):
- Never chain `cd <worktree>` with further git commands in one Bash call; use `git -C <path>` instead.
- Never write multi-line commands or heredocs alongside `./hey` in one Bash call.
- Run `./hey graph guidance "commit and push changes"` to get the verified command sequence before non-trivial git operations.

## Retrieval Proof (RP5)

Before proposing a `decision`, changing a `task` status, creating a non-trivial task, or answering architecture/dependency questions, follow [`playbook_retrieval-protocol`](content/playbooks/playbook_retrieval-protocol.md):
1. Run `./hey search "<query>"` or `./hey graph context <id>` (and `./hey deps check "<intent>"` for change-intent work).
2. Cite a compact `Sources checked: [[id1]], [[id2]]` line in your response or in the artifact's `sources:` / `relations:`.
3. Never fabricate citations from memory when search returns 0 results — state `Sources checked: none found (<query>)`.

## Domain Routing

When the user asks about a topic, check `workspace/$MEMBER/profile.md` and `content/vocab/members.yml` to understand team roles:
- If the work is in the current member's domain, help them execute directly.
- If the work crosses into another member's domain, flag it and offer to send an inbox item (`./hey inbox send --to <member> ...`).
- When a canonical `meeting` artifact is created or imported under `content/meetings/`, run `./hey meeting notify <meeting-id-or-path>` after the final meeting content is written so all internal team members in `content/vocab/members.yml` receive an inbox read notification.

## Slash Commands

| Command | When |
|---------|------|
| `/setup` | First-time member onboarding |
| `/upgrade` | Bring checkout up to latest repo capabilities (`./hey upgrade`) |
| `/morning` | Start of day — git pull, inbox, tasks, iteration goals, focus pick |
| `/sync` | Weekly team ceremony — close last iteration, open next, carry-over, fan-out |
| `/standup` | Daily standup note |
| `/whatnext` | Staged prioritization — pick next task with full context |
| `/check` | Quick mid-day status + inbox check |
| `/snap` | Save progress checkpoint to today's worklog |
| `/night` | End of day — wrap up, update statuses, draft tomorrow's priorities |
| `/task` | Create a task with proper fields |
| `/task-status` | Audit and update task statuses |
| `/idea` | Capture a raw idea to `workspace/$MEMBER/ideas/` |
| `/promote` | Promote an inbox item or idea to a canonical `task` or `note` |
| `/decide` | Draft an ADR (`decision` artifact) with sources |
| `/assess` | Evaluate an external event or proposal against active work |
| `/search` | Search artifacts across `content/` and `workspace/` |
| `/validate` | Run `./hey validate` + principles check |
| `/clean` | Archive done tasks and compact old logs |
| `/review-roadmap` | Review active goals, initiatives, and task progress |
| `/launch-frontend` | Launch the local management board UI (`apps/board` + `apps/api`) |
| `/weekly-report` | Generate weekly team executive digest |
