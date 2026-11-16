# Skills Directory (Cross-Agent Standard)

Canonical skills live under `.agents/skills/` and are symlinked into `.claude/skills/` so Claude Code, Codex, Antigravity, OpenCode, and other `SKILL.md`-compatible agents load the exact same instructions without slash-command dependencies.

## Desk & Operations Skills

| Skill | Purpose |
| --- | --- |
| `desk-bootstrap/` | First-run onboarding, runtime preflight, `init` vs `join` setup, and starter pruning (`./hey setup`) |
| `desk-daily/` | Command-free daily work desk loop: morning open + catch-up, mid-day snap/check/claim, nightly reflection (`./hey loop`, `./hey log`) |
| `desk-connectors/` | Two-track external ingestion setup (`agent-mcp` vs `api-token`) and agent-managed cron registration (`./hey connector`, `./hey cron`) |
| `desk-weekly/` | Weekly iteration rotation, roadmap/initiative check, and hygiene sweep (`./hey iteration`, `./hey hygiene`) |

## Core Passive & Engineering Skills

| Skill | Purpose |
| --- | --- |
| `mgmt-principles/` | Self-review checklist (`GP1–GP7`, `OP1–OP4`, `ARCH1–ARCH3`) |
| `explanatory-integrity/` | Mandatory closing plain-language summary |
| `update-task-tree/` | Always-on task DoD verification and connected task/initiative tree status propagation |
| `long-run-discipline/` | Discipline for multi-step, long-running engineering and research execution |
| `shared-libs/` | 3-hop discovery, reuse, and extraction workflow over the `role: shared-libraries` repo |
