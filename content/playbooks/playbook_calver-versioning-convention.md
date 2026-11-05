---
id: playbook_calver-versioning-convention
type: playbook
title: CalVer Versioning Across hey-mgmt Repos
created_at: '2026-04-08'
updated_at: '2026-04-08'
playbook_version: 1.0.0
owner: team
status: active
tags:
  - Operations
  - Documentation
relations:
  - type: supports
    target: playbook_delivery-practices
  - type: mentions
    target: playbook_file-placement
sources: []
---

# CalVer Versioning Across hey-mgmt Repos

## Purpose

Keep release tags and changelog ranges consistent across the deployable hey-mgmt repos. This is shared team know-how, so it belongs in `content/playbooks/` rather than as a root doc about the mgmt repo itself.

## Scope

This playbook applies to product repos that ship frontend, backend, or contract changes. It does not version `hey-mgmt` artifacts, derived runtime state, or local tooling state.

## Convention

Use Calendar Versioning with the format `YYYY.MM.seq`.

| Segment | Meaning | Example |
| --- | --- | --- |
| `YYYY` | Full year | 2026 |
| `MM` | Month, no leading zero | 3 |
| `seq` | Sequence within that month, starting at 1 | 1, 2, 3 |

Examples: `2026.1.1`, `2026.3.2`, `2025.12.1`

## Why CalVer

- No decision fatigue: the date is the version.
- Self-documenting: `2026.3.1` already tells you when it shipped.
- Changelog-friendly: user-facing changelogs are date-based, so tag ranges stay legible.
- Product-oriented: semver’s breaking-change semantics are a weak fit for shipped apps and contract deployments.

## Repo Rules

### Frontend (`app-frontend`)

- Tag: `YYYY.MM.seq`
- `package.json` version: same CalVer string
- Tag on each production deploy to `main`
- Static GCS deploys do not need Docker image tags

### Backend (`core-service`)

- Tag: `YYYY.MM.seq`
- `package.json` version: same CalVer string
- Tag on each production deploy to `main`
- Docker images continue using commit SHA tags
- Argo CD continues referencing commit SHAs in Helm values

### Contract (`private-hey-mgmt-contract`)

- Tag: `YYYY.MM.seq-{chain}`
- Chain suffix is REQUIRED because the same code version may deploy to multiple chains
- Tag on each production deployment or upgrade per chain
- The same commit MAY carry multiple tags, one per chain

## What Does Not Change

- Docker image tags remain commit SHAs
- Argo CD Helm values remain commit SHAs
- CI/CD pipelines do not need a versioning-specific redesign
- Old semver tags stay in git history and MUST NOT be deleted

## Backfill Reference

CalVer tags were backfilled in March 2026 for the period 2025-12 through 2026-03. Old semver tags such as `v0.12.13`, `v0.4.29`, and `v1.1.0-kaia` remain in history alongside the CalVer tags.
