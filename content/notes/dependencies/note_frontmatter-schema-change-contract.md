---
id: note_frontmatter-schema-change-contract
type: note
title: Frontmatter Schema & Indexer Change Contract
created_at: '2026-11-05'
updated_at: '2026-11-05'
status: active
owner: team
area: Team
tags:
  - ChangeImpact
  - Operations
entities:
  - HeyMgmt
  - Board
  - KnowledgeGraph
relations:
  - type: implements
    target: decision_adr-kb-wide-change-contracts
  - type: mentions
    target: decision_simplify-frontmatter
sources:
  - type: code
    ref: scripts/lib/frontmatter-schema.mjs
    note: Canonical frontmatter schema validator
  - type: code
    ref: scripts/lib/indexer.mjs
    note: Manifest and index builder
x_change_contract:
  summary: >-
    Changing frontmatter fields or validation rules requires synchronized
    updates across the CLI schema, indexer, SQLite catalog, and board UI
    loaders.
  triggers:
    repos:
      - hey-mgmt
    paths:
      - scripts/lib/frontmatter-schema.mjs
      - scripts/lib/validate.mjs
      - scripts/lib/indexer.mjs
      - content/vocab/
    areas:
      - Team
    entities:
      - HeyMgmt
      - Board
    intents:
      - update
      - change
      - migrate
      - rename
    terms:
      - frontmatter
      - schema
      - manifest
      - vocab
  obligations:
    - id: sync-schema-and-indexer
      title: 'Synchronize frontmatter schema, indexer, catalog DB, and board types'
      severity: required
      repos:
        - hey-mgmt
      entities:
        - HeyMgmt
        - Board
      owners:
        - team
      actions:
        - >-
          Update scripts/lib/frontmatter-schema.mjs and scripts/lib/validate.mjs
          together.
        - Rebuild derived state via ./hey index build and ./hey db build.
        - >-
          Verify apps/board data loaders and unit tests pass if manifest fields
          changed.
      verification:
        - ./hey validate
        - pnpm test
---

## Overview

Any change to canonical frontmatter fields, artifact types, or controlled vocabularies (`content/vocab/`) affects the portable core (`scripts/lib/frontmatter-schema.mjs`, `scripts/lib/validate.mjs`, `scripts/lib/indexer.mjs`) as well as the optional SQLite catalog (`scripts/lib/catalog-db.mjs`) and web board (`apps/board/`).
