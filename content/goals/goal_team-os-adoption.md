---
id: goal_team-os-adoption
type: goal
title: Adopt hey-mgmt as the Shared Team Operating System
created_at: '2026-11-05'
updated_at: '2026-11-05'
status: active
owner: alice
area: Team
target_date: '2026-12-31'
tags:
  - Operations
  - Onboarding
entities:
  - HeyMgmt
  - Board
relations:
  - type: advanced_by
    target: initiative_team-workspace-onboarding
sources:
  - type: doc
    ref: ARCHITECTURE.md
    note: Portable core and optional periphery contract
---

## Outcome

Establish `hey-mgmt` as the single source of truth for goals, initiatives, tasks, decisions, meetings, playbooks, and knowledge notes across the team.

## Success Metrics

- Every active team member has a configured `.env` (`MEMBER`) and `workspace/<member>/profile.md`.
- All active initiatives and tasks pass `./hey validate` with zero errors.
- Weekly `/sync` and daily `/morning` ceremonies run against shared Markdown artifacts.
