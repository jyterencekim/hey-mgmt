---
id: decision_adr-agent-agnostic-desk-bootstrap
type: decision
title: "ADR: Agent-Agnostic Desk Bootstrap, Command-Free Skill Routing, and Agent-Managed Cron Ingestion"
created_at: '2026-11-16'
updated_at: '2026-11-16'
area: Team
owner: team
owners:
  - team
status: active
decision_status: accepted
tags:
  - Operations
  - Onboarding
  - Automation
  - DeveloperExperience
relations:
  - type: follows
    target: decision_adr-repo-wide-capability-upgra
sources:
  - kind: doc
    ref: content/decisions/decision_adr-repo-wide-capability-upgra.md
    title: "ADR: Repo-wide capability upgrade command (desired-state, not migrations)"
  - kind: doc
    ref: ARCHITECTURE.md
    title: "Portable core vs optional periphery architecture contract"
---

## Context

`hey-mgmt` already consolidated agent instructions into `AGENTS.md`, added portable credential templates (`.env.example`), and adopted desired-state capability checks (`./hey upgrade`). However, three friction points still blocked using `hey-mgmt` as a continuous start-of-day to end-of-day work desk across arbitrary AI agent runtimes (Claude Code, Codex, Antigravity, Cursor, OpenCode):

1. **Slash-command and Claude-hook coupling:** Daily and onboarding workflows (`/setup`, `/morning`, `/snap`, `/night`, `/sync`) lived only under `.claude/commands/` and relied on `.claude/settings.json` hooks, so agents without Claude slash-command loading skipped core desk flows and validation.
2. **Non-TTY wizard conflict & `init` vs `join` conflation:** Interactive terminal prompts block inside agent `Bash` sandboxes, while unguided markdown instructions lead to inconsistent `.env` / YAML edits (including `.env` overwrite risks). Starter template adoption (`init`) and joining an active team repo (`join`) were also mixed together.
3. **Fragmented connector setup and OS-level cron fragility:** External activity settings were split across `.env`, `content/policies/external-activity.yml`, `workspace/fisher/config/external-activity.yml`, and `content/policies/meeting-ingestion.yml`, while assuming an always-on host or OS `launchd`/`crontab` configuration that breaks across member environments.

## Decision

Adopt five coordinated architectural decisions (`D1–D5`):

- **D1 — Dual-Surface Deterministic CLI + Thin Bootstrap Prompt:** Keep all state inspection, atomic file edits, and smoke tests inside non-TTY JSON/flag `./hey` subcommands (`./hey setup`, `./hey connector`, `./hey cron`, `./hey activity push-events`), preserving existing `.env` secrets via key-level upsert. Keep conversational guidance and progressive disclosure in `BOOTSTRAP.md` and cross-agent skills so any agent runs the exact same deterministic mutations.
- **D2 — Command-Free Desk Routing (`.agents/skills/` + `AGENTS.md` + `.githooks/pre-commit`):** Consolidate core desk workflows into four cross-agent standard skills under `.agents/skills/{desk-bootstrap,desk-daily,desk-connectors,desk-weekly}/SKILL.md` (symlinked into `.claude/skills/` for Claude compatibility, with thin wrappers in `.claude/commands/`). Add a `First-Run Bootstrap Gate` and natural-language `Desk Intent Router` to `AGENTS.md`, and enforce `./hey validate` on commit via `.githooks/pre-commit`.
- **D3 — `init` vs `join` Onboarding Split:** Auto-detect starter fixture state (`alice`/`bob` untouched) to recommend `init` mode (with optional `--prune-starters`, area setup, and sibling git repo scan for `repos.yml`) vs active team repo state (`join` mode).
- **D4 — Two-Track Ingestion Onboarding (`agent-mcp` + `api-token`):** Support both zero-token host-agent MCP/plugin bridges (normalizing and piping events into `./hey activity push-events --stdin`) and API-token/service-account collectors (`./hey connector manifest|discover|configure|test`) that synchronize policy, runtime config, and `.env` atomically.
- **D5 — Agent-Managed Cron over OS Daemons:** Never require OS `launchd` or `crontab` setup for member desks. Instead, `./hey cron render` produces stateless, self-contained prompts and `CRON_TZ` schedules that register directly inside each user's AI agent scheduler (Antigravity Automations, Claude Scheduled Tasks, Codex Automations, Hermes), guarded by `./hey cron preflight` cooldowns and stale-watermark catch-up on morning desk open.

## Alternatives Considered

- **Interactive terminal-only TUI wizard (`inquirer`):** Rejected because AI agent tool shells execute non-interactively (no TTY), forcing agents to guess or fail.
- **Pure Markdown instructions without CLI backing:** Rejected because different LLMs rewrite YAML and `.env` inconsistently and risk clobbering secrets.
- **OS-level `launchd` / `crontab` installer scripts:** Rejected because Node path managers, OS permissions, and lack of LLM classification context make OS-level daemons brittle on personal laptops, whereas agent-managed crons already own an LLM turn and MCP context.

## Consequences

- Any AI agent environment can initialize a desk from one prompt (`Read AGENTS.md and BOOTSTRAP.md...`), connect Slack/Drive/Notion/GitHub via MCP or API token, and continue daily work seamlessly across agents.
- Scheduled ingestion and daily digests survive laptop sleep via `./hey cron preflight` cooldowns and stale-connector detection on desk open (`buildLoopDigest`).
