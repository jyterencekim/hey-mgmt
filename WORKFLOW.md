---
tracker:
  kind: markdown
  tasks_dir: content/tasks
  active_statuses:
    - ready
    - doing
  terminal_statuses:
    - done
    - archived
    - cancelled

polling:
  interval_ms: 30000

workspace:
  root: .hey/workspaces

hooks:
  after_create: |
    echo "Workspace ready for {{ task.id }}"
  before_remove: |
    echo "Cleaning up {{ task.id }}"

agent:
  max_concurrent_agents: 2
  max_turns: 15
  max_retry_backoff_ms: 300000
  command: "claude --print"

validation:
  before_complete: "./hey validate"
---

You are working on task `{{ task.id }}`: **{{ task.title }}**

## Context

- **Area**: {{ task.area | default: "General" }}
- **Priority**: {{ task.priority | default: "plan" }}
- **Iteration**: {{ task.iteration | default: "unscheduled" }}
- **Attempt**: {{ attempt | default: 1 }}

## Task Description

{{ task.body }}

## Definition of Done

{% for item in task.definition_of_done %}
- [ ] {{ item }}
{% endfor %}

## Instructions

1. Read relevant context using `./hey search` and `./hey graph context {{ task.id }}`.
2. Work on the task deliverables.
3. Update the task file (`{{ task.path }}`) with progress notes and findings.
4. When all Definition of Done criteria are met, update `status: done` in the task frontmatter.
5. Run `./hey validate` before finishing.
6. Follow all rules in `CLAUDE.md` and `AGENTS.md`.
