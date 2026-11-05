---
id: playbook_agent-session-conventions
type: playbook
title: >-
  Agent session conventions: repo shorthand, planning from the task ledger not
  the run ledger, notify via inbox, member names, hermes crons go to charlie
created_at: '2026-09-14'
updated_at: '2026-09-14'
playbook_version: 0.1.0
owner: team
status: active
tags:
  - Operations
  - Automation
  - Documentation
relations:
  - type: supports
    target: playbook_interaction-tone
sources:
  - kind: doc
    ref: workspace/charlie/memory/project_kaia-usdt-environments.md@6660cc0f4
    title: 'frontend = app-frontend, backend = core-service'
  - kind: doc
    ref: >-
      workspace/charlie/memory/feedback_run_ledger_is_not_a_live_work_signal.md@6660cc0f4
    title: 'loop brief Active runs is a claim ledger, not live work'
  - kind: doc
    ref: workspace/charlie/memory/feedback_notify_via_inbox.md@6660cc0f4
    title: 'Notify via hey inbox capture, not Slack'
  - kind: doc
    ref: workspace/charlie/memory/feedback_use_member_names.md@6660cc0f4
    title: 'Use member names, not git author names'
  - kind: doc
    ref: >-
      workspace/charlie/memory/feedback_hermes_cron_operator_terence.md@6660cc0f4
    title: Hermes cron registration is charlie's operator duty
  - kind: doc
    ref: workspace/charlie/memory/feedback_auditor_use_api_not_mcp.md@6660cc0f4
    title: 'In the auditor repo, use the HTTP API, not the MCP'
x_procedure_graph:
  schema: procedural-graph/v0
  cycle_policy: acyclic
  nodes:
    - id: start
      kind: start
    - id: resolve_shorthand
      kind: check
      tool: read request
      title: Resolve repo shorthand
    - id: plan_from_tasks
      kind: check
      tool: ./hey db query
      title: 'Plan from task status, joined to runs'
    - id: do_work
      kind: action
      tool: work
      title: Do the work
    - id: notify
      kind: action
      tool: ./hey inbox capture --workspace <member>
      title: Notify members
    - id: report
      kind: action
      tool: write log or report
      title: Report with member names
    - id: end
      kind: end
  edges:
    - src: start
      rel: LEADS_TO
      dst: resolve_shorthand
      guidance: >-
        "frontend" means core-usdt-miniapp-frontend and "backend" means
        core-usdt-miniapp; resolve immediately, do not ask which
    - src: resolve_shorthand
      rel: LEADS_TO
      dst: plan_from_tasks
      guidance: >-
        infer in-flight work from do-priority tasks, today's commits and
        cross-repo activity; join every run in ./hey work runs to its task's
        status and read claimed_at
      pitfalls: >-
        the Active runs lane is only closed by ./hey work complete, so runs stay
        in_progress forever (one 'active' for 43 days); four 'stuck runs' on
        2026-08-14 were all false positives. Iteration turns do not update task
        metadata either
    - src: plan_from_tasks
      rel: LEADS_TO
      dst: do_work
      guidance: >-
        when the user says they will work on something, claim it with ./hey work
        claim; never ask them to run lifecycle commands
      pitfalls: >-
        inside the hey-mgmt-auditor repo use curl against auditor.hey-mgmt.io
        routes, not the MCP tools; the MCP is for mgmt-side financial lookups
    - src: do_work
      rel: LEADS_TO
      dst: notify
      condition: someone must be told
      guidance: hey inbox capture per member workspace; Slack only when explicitly asked
      pitfalls: >-
        operator steps for Hermes cron registration on the Mac Mini go to
        charlie's inbox, not alice's (re-routed once, 2026-08-14)
    - src: do_work
      rel: LEADS_TO
      dst: report
      condition: nobody else needs notifying
      guidance: report
    - src: notify
      rel: LEADS_TO
      dst: report
      guidance: then report
    - src: report
      rel: LEADS_TO
      dst: end
      guidance: >-
        member names only (dana, alice, bob, charlie); map git authors Dana Lee →
        dana, lwj010 → alice. Lead with task titles, not ids
---

# Agent session conventions

Six small feedback memories that every session needs and none of which belong
to a single repo. Interaction tone stays in `playbook_interaction-tone`.
