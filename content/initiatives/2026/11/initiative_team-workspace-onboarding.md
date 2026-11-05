---
id: initiative_team-workspace-onboarding
type: initiative
title: Team Workspace & Vocabulary Onboarding
created_at: '2026-11-05'
updated_at: '2026-11-05'
status: active
owner: alice
area: Team
x_initiative_kind: ops
x_timeline_start: '2026-11-05'
x_timeline_end: '2026-11-30'
definition_of_done:
  - >-
    Register all team members in content/vocab/members.yml and create
    workspace/<member>/profile.md
  - >-
    Customize content/vocab/areas.yml, repos.yml, tags.yml, and entities.yml for
    the team's domain
  - 'Verify ./hey validate, ./hey index build, and apps/board run cleanly'
tags:
  - Operations
  - Onboarding
entities:
  - HeyMgmt
  - Board
relations:
  - type: contributes_to
    target: goal_team-os-adoption
  - type: parent_of
    target: task_complete-team-onboarding
sources:
  - type: doc
    ref: content/playbooks/playbook_operating-philosophy.md
    note: Operating philosophy OP1-OP4
---

## Objective

Configure `hey-mgmt` for our team's members, areas, repositories, and domain vocabulary so daily workflows (`/morning`, `/whatnext`, `/snap`, `/sync`) and the management board work out of the box.

## Scope

1. Update `content/vocab/` registries (`members.yml`, `areas.yml`, `repos.yml`, `tags.yml`, `entities.yml`).
2. Set up member workspaces under `workspace/<member>/`.
3. Run `./hey upgrade --yes` and `./hey validate`.
