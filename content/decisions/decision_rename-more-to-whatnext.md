---
id: decision_rename-more-to-whatnext
type: decision
title: 'ADR: Rename /more command to /whatnext'
created_at: '2026-03-30'
updated_at: '2026-03-30'
owner: team
status: active
decision_status: accepted
owners:
  - team
tags:
  - Operations
relations: null
sources:
  - kind: file
    ref: .claude/commands/whatnext.md
    title: /whatnext slash command
  - kind: file
    ref: .claude/commands/more.md
    title: /more slash command (removed)
---

## Context

The `/more` command claims the highest-priority agent task and starts working on it. Despite being useful, the command was rarely used because the name was not self-explanatory — "more" could mean anything without context.

## Decision

Rename `/more` to `/whatnext`.

- `/whatnext` immediately communicates intent: "what should I work on next?"
- Discoverability matters more than brevity for infrequently used commands
- The underlying behavior is unchanged — claim and execute the top-priority task

## Consequences

- Team members need to use `/whatnext` instead of `/more`
- Better discoverability should increase actual usage of the command
- No backward compatibility shim — `/more` is removed
