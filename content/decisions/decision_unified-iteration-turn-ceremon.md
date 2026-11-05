---
id: decision_unified-iteration-turn-ceremon
type: decision
title: Unified iteration turn ceremony
created_at: '2026-03-18'
updated_at: '2026-03-18'
owner: team
status: active
decision_status: accepted
owners:
  - team
sources:
  - url: .claude/commands/iteration-turn.md
    title: iteration-turn command definition
  - url: .claude/commands/iteration-close.md
    title: 'iteration-close command definition (standalone, preserved)'
area: Team
---

## Context

The iteration lifecycle has separate `/iteration-close` (retrospective + carry-forward) and `/iteration-open` (new goals from carry-forward + tasks) commands. In practice, `/iteration-close` is never run standalone — W11 was never closed before W12 was opened. The carry-forward pipeline breaks because nobody remembers to close before opening.

## Decision

Create a unified `/iteration-turn` command that closes the previous iteration and opens (or merges into) the new one in a single ceremony. Keep `/iteration-close` and `/iteration-open` as standalone commands for edge cases.

### Decision Drivers
1. Carry-forward from close is the primary input for open — separate commands lose this data
2. Nobody runs close independently (evidenced by W11 never being closed)
3. The morning routine is the natural trigger point

### Alternatives Considered

| Option | Verdict | Reason |
|--------|---------|--------|
| **A: New `/iteration-turn`** | **Chosen** | Clear semantic name, dedicated ceremony, preserves existing commands |
| **B: Extend `/iteration-open` to auto-close** | Rejected | Overloads open with dual responsibility, hides the retrospective step |

### Key Design Choices
- Close logic is **inlined** in turn (not delegated to `/iteration-close`) to avoid date-derivation bugs — close uses the target iteration's `x_iteration` field, not today's date
- When current week's log **already exists**, carry-forward is **merged** into existing goals (not silently dropped)
- Multiple unclosed iterations are closed chronologically (oldest first)
- `/iteration-open` gains a **nudge** warning when it detects unclosed previous iterations
- `/morning` step 5 uses a **three-way branch**: turn (previous unclosed) vs open (fresh) vs extract (log exists)

## Consequences

- `/iteration-turn` becomes the standard weekly ceremony (triggered via `/morning` prompt)
- Carry-forward items flow automatically from one iteration to the next
- `/iteration-close` and `/iteration-open` remain for edge cases (mid-week close, manual open)
- The retrospective is a conscious act (user must accept the prompt), not hidden automation

## Follow-ups
- Backfill W11 close (it is currently `status: active` with empty Carry-Forward and Summary)
- Monitor whether standalone close/open are ever used; consider deprecation if not
