# Artifact Templates

> **Read-only reference.** Do not edit these templates directly. Use `./hey new --type <type> --title "..."` to scaffold new artifacts, or copy-paste the relevant template below.

## task

```yaml
---
id: task_<slug>
type: task
title: "<short action title>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
status: ready                # ready | doing | blocked | done | archived | plan | cancelled  (task lifecycle)
owner: <member-name>
project: <project-name>
priority: plan               # do | plan | routine | drop — see decision_adr-replace-p0-p3-priority-wit
due_date: YYYY-MM-DD         # optional
iteration: YYYY-WNN          # required for ready / blocked / doing tasks
definition_of_done:
  - "<testable outcome 1>"
  - "<testable outcome 2>"
tags: []
relations: []
sources: []
---

## Context
<!-- Why does this task exist? -->

## Definition of Done
- [ ] <testable outcome 1>
- [ ] <testable outcome 2>
```

Optional execution metadata MAY live under `x_*` fields. For explicit assignee acknowledgement without changing task status, use:

```yaml
x_acknowledged:
  by: <member-name>
  at: 2026-04-17T06:15:00Z
  note: "<optional acknowledgement note>"
```

## decision

```yaml
---
id: decision_<slug>
type: decision
title: "ADR: <what was decided>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
decision_status: accepted     # proposed | accepted | deprecated | superseded
owners:
  - <member-name>
project: <project-name>
tags: []
relations: []
sources:
  - url: "<link>"
    title: "<source title>"
  - kind: doc
    ref: "<path>"
    title: "<doc title>"
---

## Context
<!-- What problem or question triggered this decision? -->

## Decision
<!-- What did we decide and why? -->

## Consequences
<!-- What follows from this decision? Trade-offs, risks, follow-up work. -->

## Alternatives Considered
<!-- What options were rejected and why? -->
```

## meeting

```yaml
---
id: meeting_<slug>
type: meeting
title: "<meeting topic>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
status: active
owner: <member-name>
project: <project-name>
attendees:
  - <member-name>
start_at: YYYY-MM-DDTHH:MM:SSZ
end_at: YYYY-MM-DDTHH:MM:SSZ
tags: []
relations: []
sources: []
---

## Context
<!-- What was the purpose of this meeting? -->

## Notes
<!-- Key discussion points and decisions made. -->

## Action Items
- [ ] <owner>: <action>
```

## playbook

```yaml
---
id: playbook_<slug>
type: playbook
title: "<how to do X>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
playbook_version: "1.0.0"    # semver, required
status: active
owner: <member-name>
project: <project-name>
tags: []
relations: []
sources: []
---

## Purpose
<!-- What does this playbook help you accomplish? -->

## Prerequisites
<!-- What must be true before starting? -->

## Steps
1. ...
2. ...
3. ...

## Troubleshooting
<!-- Common failure modes and how to resolve them. -->
```

## note

```yaml
---
id: note_<slug>
type: note
title: "<descriptive title>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
status: active
owner: <member-name>
project: <project-name>
tags: []
relations: []
sources: []
---

## Context
<!-- What is this note about? Specs, findings, analysis, alerts, ideas — anything. -->

## Content
<!-- The substance of the note. -->
```

### note — dependency / change-impact variant

Use this for authoritative "if X changes, also do Y" knowledge. Standalone dependency notes live under `content/notes/dependencies/`, but the contract is **not** tied to that path: any content artifact (decision, playbook, note, task) can bind obligations by adding the `ChangeImpact` tag + `x_change_contract` frontmatter — prefer that over authoring a parallel note when the knowledge already lives in an existing artifact. Terminal-status artifacts (`done`/`archived`/`cancelled`) drop out of the deps pool. `triggers.terms[]` and `intents[]` are optional precision boosters — recall comes from qmd semantic search plus title/body lexical matching; at least one trigger signal of any kind is required. See [`decision_adr-kb-wide-change-contracts`](../content/decisions/decision_adr-kb-wide-change-contracts.md).

```yaml
---
id: note_<slug>
type: note
title: "<change surface> dependency impact"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
status: active
owner: <member-name>
area: <area-name>
tags:
  - ChangeImpact
relations:
  - type: links_to
    target: task_<example-follow-up-or-related-work>
sources:
  - kind: doc
    ref: content/tasks/YYYY/MM/task_<related>.md
    title: "Related task or note"
x_change_contract:
  triggers:
    repos: []
    paths: []
    areas: []
    entities: []
    intents: []
    terms: []                     # optional precision boosters; qmd + body text carry recall
  obligations:
    - title: "<follow-up obligation>"
      severity: required
      repos: []
      entities: []
      paths: []
      actions:
        - "<concrete follow-up action>"
  verification:
    - "<verification check>"
---

## Context
<!-- Why this dependency exists and what tends to be forgotten. -->

## Trigger
<!-- What kinds of intended changes should surface this note. -->

## Required Follow-Ups
- [ ] <follow-up action>

## Verification
- [ ] <verification check>

## Known Examples
- <task_xxx> — when this surfaced in real work
```

### note — iteration log variant

Use `note` type with `IterationLog` tag and `x_iteration` extension field for team-level iteration logs. Created by `/iteration-open`, appended by `/iteration-add`, closed by `/iteration-close`.

```yaml
---
id: note_iteration-log-<YYYY-wNN>
type: note
title: "Iteration Log <YYYY-WNN>"
created_at: YYYY-MM-DD
updated_at: YYYY-MM-DD
status: active                    # artifact lifecycle: in force during iteration, done when closed
owner: team
project: Core
tags: [IterationLog]
x_iteration: YYYY-WNN            # extension field for iteration identity
relations: []
sources: []
---

## Goals
<!-- Team-level goals for this iteration. Linked to task IDs where applicable. -->
- [ ] Goal description (task_xxx)

## Entries
<!-- Appended by /iteration-add. Date-stamped, categorized entries. -->
<!-- Categories: [milestone], [blocker], [decision], [coordination] -->
- YYYY-MM-DD [milestone] Description (task_xxx)

## Carry-Forward
<!-- Populated by /iteration-close. Items that did not complete this iteration. -->

## Summary
<!-- Populated by /iteration-close. Synthesized retrospective. -->
```

---

## Field Reference

| Field | Required | Notes |
|-------|----------|-------|
| `id` | Yes | Auto-generated: `{type}_{slug}`, max 30-char slug |
| `type` | Yes | `task`, `decision`, `meeting`, `playbook`, `note` |
| `title` | Recommended | Short, descriptive; not enforced by validator but expected |
| `created_at` | Yes | ISO 8601 date |
| `updated_at` | Yes | ISO 8601 date |
| `status` | Recommended | Task: `ready`, `doing`, `blocked`, `done`, `archived`, `plan`, `cancelled`. Non-task (note/playbook/decision/meeting/initiative): `active`, `archived`, `done`, `cancelled`. See `decision_adr-task-status-ready-doing`. |
| `owner` | Recommended | Must match `content/vocab/members.yml` |
| `project` | Optional | Must match `content/vocab/projects.yml` |
| `due_date` | Optional | ISO 8601 date (tasks only) |
| `iteration` | Conditional | Required for `ready`, `blocked`, and `doing` tasks; e.g. `2026-W10` |
| `tags` | Optional | Must match `content/vocab/tags.yml` |
| `entities` | Optional | Must match `content/vocab/entities.yml` |
| `relations` | Optional | `type` + `target` (target must exist) |
| `sources` | Optional | Required for decisions (min 2) |
| `x_*` | Optional | Explicit extension namespace for non-canonical module fields |

Status wording (tasks): `ready` = available to claim, `doing` = currently being worked. The old `active`/`in_progress` names were retired per `decision_adr-task-status-ready-doing`.

Example extension for external activity matching:

```yaml
x_external_refs:
  - jira:SUPER-321
  - source: confluence
    object_id: "149783426"
```

## Controlled Vocabularies

Before using `owner`, `project`, `tags`, or `entities`, check the registries:

- `content/vocab/members.yml` — valid owner names
- `content/vocab/projects.yml` — valid project names
- `content/vocab/tags.yml` — valid tag values
- `content/vocab/entities.yml` — valid entity names and aliases
