---
id: playbook_deploy
type: playbook
title: Deploy
owner: alice
updated_at: 2026-09-03
sources:
  - kind: doc
    ref: "workspace/alice/memory/feedback_push_hazard.md"
    title: original pitfall
x_procedure_graph:
  schema: procedural-graph/v0
  nodes:
    - {id: start, kind: start}
    - {id: push, kind: action, tool: git push}
    - {id: end, kind: end}
  edges:
    - {src: start, rel: LEADS_TO, dst: push, guidance: push it}
    - {src: push, rel: LEADS_TO, dst: end, guidance: done, evidence: ["mem:alice/feedback_push_hazard"]}
---
