---
id: playbook_codex-agent-compliance-guide
type: playbook
title: Codex Agent Compliance Guide
created_at: '2026-04-24'
updated_at: '2026-11-03'
playbook_version: 1.1.0
owner: team
status: active
tags:
  - Operations
  - Documentation
  - Review
relations:
  - type: supports
    target: playbook_golden-principles
  - type: supports
    target: playbook_operating-philosophy
  - type: supports
    target: playbook_governing-artifact-maintenance
  - type: supports
    target: playbook_style-guide
sources:
  - kind: doc
    ref: AGENTS.md
    title: Repository agent rules
  - kind: doc
    ref: content/playbooks/playbook_style-guide.md
    title: English style guide
  - kind: doc
    ref: content/playbooks/playbook_golden-principles.md
    title: Golden principles
  - kind: doc
    ref: content/playbooks/playbook_operating-philosophy.md
    title: Operating philosophy
  - kind: doc
    ref: content/playbooks/playbook_governing-artifact-maintenance.md
    title: Governing artifact maintenance hooks
  - kind: doc
    ref: ARCHITECTURE.md
    title: Portable core architecture
---

# Codex Agent Compliance Guide

## Purpose

Make Codex follow the same operating contract as Claude-style agents in this repo. This guide is a short execution checklist for Codex sessions, not a replacement for `AGENTS.md`.

Codex MUST treat `AGENTS.md` as the primary rule source. When this guide and `AGENTS.md` differ, `AGENTS.md` wins.

## Start Checklist

Before changing files, Codex MUST:

1. Read `AGENTS.md` for repo rules.
2. Read the English or Korean style guide that matches the output language.
3. Run `./hey deps check "<intent>"` for change-intent work.
4. Run `./hey search "<topic>"` before creating a new artifact.
5. Use `./hey new --type <type> --title "..."` for new artifacts unless there is a clear reason to hand-write one.
6. Check `content/vocab/` before using owners, tags, projects, or entities.

Change-intent work includes update, change, deploy, migrate, rename, remove, integrate, and refactor requests.

## Retrieval Requests

Codex MUST follow `content/playbooks/playbook_retrieval-protocol.md` for
retrieval-intent requests. A request is retrieval-intent when the answer depends
on finding existing artifacts, prior discussion, git history, external activity
knowledge, attachments, or current repo state.

Codex MUST include compressed Retrieval Proof in the answer. Do not present one
definitive artifact or source unless the RP5 candidate and disconfirmation
requirements are satisfied or explicitly waived by the exact-file exception.

## Write Rules

Codex MUST:

- Edit only `content/` and `workspace/` for canonical repo knowledge.
- Avoid hand-editing `index/`, `.hey/`, or `.runtime/`.
- Keep frontmatter minimal and valid.
- Put nonstandard frontmatter fields under `x_*`.
- Use existing tags, entities, owners, and projects.
- Link with `relations` instead of copying content from another artifact.
- Back decision-grade claims with `sources`.
- Keep one artifact focused on one concern.

Codex SHOULD route reusable instructions to `content/playbooks/`, rationale to `content/decisions/`, work items to `content/tasks/`, and findings or specs to `content/notes/`.

## Git Rules

Codex MUST protect user work during git operations.

- Check `git status --short --branch` before pull, merge, rebase, or commit.
- If the worktree is dirty before pull, stash or otherwise preserve local edits first.
- If conflicts occur, preserve both local and incoming content unless the user explicitly chooses one side.
- Do not use destructive commands such as `git reset --hard` or `git checkout -- <path>` unless the user explicitly asks.
- After resolving conflicts in artifacts, run the principles review and `./hey validate`.
- When deliverables are deployed or work in a branch/worktree completes, merge the shipped changes back into `develop` or `main` (per repo convention; respecting release-ownership rules), sync the local primary checkout with `origin/main` or `origin/develop` (`0 ahead / 0 behind`), and remove all completed worktrees and merged branches (`git worktree remove`, `git worktree prune`, `git branch -d`).

## Completion Checklist

Before saying work is complete, Codex MUST:

1. Run a principles self-review against:
   - `content/playbooks/playbook_golden-principles.md`
   - `content/playbooks/playbook_operating-philosophy.md`
   - `ARCHITECTURE.md`
2. Fix any principle violation before final response.
3. Run `./hey validate`.
4. Surface dependency-check obligations in the response, even when the result is "none."
5. Report validation errors and material warnings.
6. Verify post-deployment closeout: deployed changes are merged back to `develop` or `main`, the local primary checkout is synced with `origin/main` or `origin/develop`, and all completed worktrees and merged branches are cleaned up (`git worktree list` and `git status -sb`).

For large validation output, summarize the result and name representative warnings instead of pasting the full log.

## Prompt Snippet

Use this at the top of Codex sessions when strict compliance matters:

```text
Follow content/playbooks/playbook_codex-agent-compliance-guide.md exactly.
Before change-intent work, run ./hey deps check "<intent>" and surface obligations.
Before creating artifacts, run ./hey search "<topic>".
For retrieval-intent requests, follow content/playbooks/playbook_retrieval-protocol.md and show compressed Retrieval Proof.
After artifact changes, run principles review and ./hey validate.
Preserve user work during git operations.
```

## Common Failures

- Skipping `./hey deps check` before change-intent work.
- Creating an artifact without checking for an existing one.
- Answering a retrieval request from one plausible hit without RP5
  disconfirmation.
- Using a tag, owner, project, or entity outside `content/vocab/`.
- Treating `./hey validate` warnings as hidden noise.
- Resolving git conflicts by choosing one side when the user asked to preserve both.
- Editing derived files instead of the canonical markdown contract.
