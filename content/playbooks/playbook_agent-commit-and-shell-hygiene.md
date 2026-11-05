---
id: playbook_agent-commit-and-shell-hygiene
type: playbook
title: >-
  Agent commit and shell hygiene: stash only what you stashed, never echo a
  secret, zsh does not word-split, hey-mgmt-io pushes use the host alias
created_at: '2026-09-14'
updated_at: '2026-11-03'
playbook_version: 0.2.0
owner: team
status: active
tags:
  - Engineering
  - Security
  - Operations
sources:
  - kind: doc
    ref: workspace/charlie/memory/feedback-git-stash-pop-hazard.md@6660cc0f4
    title: 'git stash pop can pop an unrelated stash (memory, migrated 2026-09-14)'
  - kind: doc
    ref: workspace/charlie/memory/feedback-secret-echo-hazard.md@6660cc0f4
    title: Do not interpolate a fetched secret into an echo line
  - kind: doc
    ref: workspace/charlie/memory/feedback_zsh_loop_word_splitting.md@6660cc0f4
    title: The Bash tool runs zsh; for x in $VAR does not split
  - kind: doc
    ref: workspace/charlie/memory/reference_hey-mgmt_io_ssh_host_alias.md@6660cc0f4
    title: hey-mgmt-io pushes need the github.com-hey-mgmt host alias
  - kind: doc
    ref: >-
      workspace/charlie/memory/feedback_test_only_prs_merge_immediately.md@6660cc0f4
    title: Test-only PRs merge immediately (charlie 2026-06-09)
  - kind: doc
    ref: workspace/charlie/memory/reference_codex_service_tier_fix.md@6660cc0f4
    title: Local codex needs -c service_tier=flex
x_procedure_graph:
  schema: procedural-graph/v0
  cycle_policy: acyclic
  nodes:
    - id: start
      kind: start
    - id: stage_own_files
      kind: action
      tool: git add <files>
      title: Stage only your own files
    - id: commit
      kind: action
      tool: git commit
      title: Commit with the session attribution line
    - id: guarded_stash
      kind: check
      tool: git stash
      title: 'Stash, remembering whether an entry was created'
    - id: pull_rebase
      kind: action
      tool: git pull --rebase
      title: Rebase on origin
    - id: pop_if_created
      kind: action
      tool: git stash pop
      title: Pop only the entry you created
    - id: push
      kind: action
      tool: git push origin main
      title: Push
    - id: merge_pr
      kind: action
      tool: gh pr merge --squash
      title: Merge a PR or merge back to develop/main (squash; admin for test-only)
    - id: sync_and_cleanup
      kind: action
      tool: git fetch origin && git worktree remove && git branch -d
      title: >-
        Sync local base branch with remote and clean up completed
        worktrees/branches
    - id: end
      kind: end
  edges:
    - src: start
      rel: LEADS_TO
      dst: stage_own_files
      guidance: stage the files you changed by name; other sessions share the tree
      pitfalls: >-
        git add -A sweeps another session's untracked evidence dirs into your
        commit (happened 2026-09-14 with core-v0518 files)
    - src: stage_own_files
      rel: LEADS_TO
      dst: commit
      guidance: >-
        commit; end the message with the Claude-Session attribution line the
        session asks for
      pitfalls: >-
        never put a secret variable on an echo/printf/log line, not even inside
        ${VAR:+...}; ${#VAR} (length) is the only safe thing to print. A leaked
        secret is compromised: rotate it
    - src: commit
      rel: LEADS_TO
      dst: guarded_stash
      guidance: >-
        run git stash and capture its output; 'No local changes to save' means
        NO entry was created
    - src: guarded_stash
      rel: LEADS_TO
      dst: pull_rebase
      guidance: git pull --rebase
      pitfalls: >-
        in zsh, for x in $VAR runs once with the whole string; use an array or
        ${=VAR}. set -- $step does not split either. A dispatch loop that 'only
        launches 1' is word-splitting, not rate limiting
    - src: pull_rebase
      rel: LEADS_TO
      dst: pop_if_created
      condition: your git stash printed 'Saved working directory'
      guidance: pop by the exact ref you created
      pitfalls: >-
        an unconditional pop after 'No local changes to save' pops someone
        else's autostash into your clean tree and leaves UU conflicts
        (2026-09-14, four v2-keeper files). If it happens: git restore --staged
        --worktree the files; the foreign stash is still on the stack, do not
        drop it
    - src: pull_rebase
      rel: LEADS_TO
      dst: push
      condition: no stash entry was created
      guidance: push directly
    - src: pop_if_created
      rel: LEADS_TO
      dst: push
      guidance: push to origin main
      pitfalls: >-
        hey-mgmt-io repos accept SSH only via
        git@github.com-hey-mgmt:hey-mgmt-io/<repo>.git; plain github.com is
        refused with 'correct access rights'. gh repo create --push therefore
        creates the repo but fails the push
    - src: push
      rel: LEADS_TO
      dst: merge_pr
      condition: the work went through a PR or deploy branch
      guidance: >-
        mark ready and squash-merge (or merge back to develop/main per repo
        convention) in the same session; finished and deployed work MUST land on
        develop or main. hey-mgmt-ops-runtime rejects merge commits
      pitfalls: >-
        a PR whose diff is only tests/fixtures can be admin-merged past pending
        checks (gh pr merge --squash --admin); do not babysit CI for it
    - src: push
      rel: LEADS_TO
      dst: sync_and_cleanup
      condition: 'direct push, no PR'
      guidance: proceed to final local sync and worktree/branch cleanup
    - src: merge_pr
      rel: LEADS_TO
      dst: sync_and_cleanup
      guidance: >-
        deploy from the main checkout, not the branch; after deploy
        verification, sync local and clean up
    - src: sync_and_cleanup
      rel: LEADS_TO
      dst: end
      guidance: >-
        in the primary local checkout, fetch and sync local main/develop with
        origin/main or origin/develop (0 ahead / 0 behind), remove completed
        worktrees (git worktree remove, git worktree prune), delete merged
        branches (git branch -d), and confirm with git worktree list and git
        status -sb
---

# Agent commit and shell hygiene

Six memories, all about the last five minutes of a task, folded into the commit
procedure where each one bites. The transitions after `pull --rebase` branch on
whether your own stash created an entry; that fork is the whole point. At closeout,
every completed deployment or branch workflow MUST merge back to `develop` or `main`,
sync the local primary checkout with remote (`main...origin/main` or `develop...origin/develop`),
and remove all completed worktrees and merged branches.

Codex note: the local `codex` CLI needs `-c service_tier="flex"` (stale
`priority` in `~/.codex/config.toml`).
