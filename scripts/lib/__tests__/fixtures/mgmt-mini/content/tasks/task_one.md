---
id: task_one
type: task
title: Task one
owner: alice
updated_at: 2026-09-02
relations:
  - type: child_of
    target: initiative_demo
  - type: depends_on
    target: task_two
  - decision_pick
---
See [[note_ctx]], [[task_two]] (already a typed relation, so not double-counted) and [[task_missing]] and [the decision](../decisions/decision_pick.md).
