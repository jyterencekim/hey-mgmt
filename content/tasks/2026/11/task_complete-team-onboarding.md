---
id: task_complete-team-onboarding
type: task
title: Customize vocabulary registries and member workspaces
created_at: '2026-11-05'
updated_at: '2026-11-05'
status: ready
owner: alice
area: Team
priority: do
iteration: 2026-W45
x_start_date: '2026-11-05'
x_target_date: '2026-11-12'
definition_of_done:
  - Update content/vocab/members.yml with actual team member names and roles
  - >-
    Update content/vocab/areas.yml and content/vocab/repos.yml for our
    repositories
  - Run ./hey validate and ./hey index build with zero errors
tags:
  - Onboarding
  - Operations
entities:
  - HeyMgmt
relations:
  - type: child_of
    target: initiative_team-workspace-onboarding
  - type: implements
    target: decision_linear-ontology-adoption
sources:
  - type: doc
    ref: docs/ONBOARDING.md
    note: Team onboarding checklist
---

## Context

This starter task verifies that the `hey-mgmt` template is ready for your team.

## Steps

1. Edit `content/vocab/members.yml` and create `workspace/<member>/profile.md` for each member.
2. Edit `content/vocab/areas.yml`, `content/vocab/repos.yml`, `content/vocab/tags.yml`, and `content/vocab/entities.yml`.
3. Run `./hey validate` and `./hey index build`.
4. Mark this task `status: done` once onboarding is complete.
