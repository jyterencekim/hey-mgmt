# Onboarding Checklist

Welcome to the team. Follow these steps to get set up.

---

## 1. Clone the repo & check prerequisites

Prerequisites:
- **Node.js** >= 22 & **pnpm**
- (macOS) `brew install sqlite` (required for local semantic search and SQLite tools)

```bash
git clone <repo-url>
cd hey-mgmt
```

---

## 2. Run the setup command

```
/project:setup
```

This installs dependencies, sets your `MEMBER` and preferred `LANGUAGE` in `.env`, builds lexical indexes, sets up local semantic search (`qmd`), builds the knowledge graph (`.kg/graph.sqlite`), and validates the workspace. All AI responses and generated content will follow your chosen language.

---

## 3. Fill in your member profile

Create `workspace/$MEMBER/profile.md` with:

- **Domains** — areas you own or contribute to
- **Repos** — which repos you work in, your role, relevant skills, and MCPs per repo

See [`workspace/terence/profile.md`](../workspace/terence/profile.md) as an example.

---

## 4. Know the sibling repos, then create your repos list

The team-wide registry is [`content/vocab/repos.yml`](../content/vocab/repos.yml): every repo in the `hey-mgmt-io` org plus the `kaiachain` and partner repos we touch, each with its org, status (`active | dormant | archive | reference`), and one-line purpose. Read it once; it is the answer to "which repo does X live in".

Convention: siblings are checked out beside this repo (`../hey-mgmt-auditor`, …). When a checkout name differs from the repo name, the registry says so in `local_dir` (for example `hey-mgmt-core` lives in `../private-hey-mgmt-contract`).

The unified knowledge graph over all of this is built directly into this repo (`./hey graph`). Run `./hey graph build` to generate the local projection (`.kg/graph.sqlite`); query it with `./hey graph search <term>`, `./hey graph neighborhood <id>`, and `./hey graph guidance --tool "<last tool call>"`. Export sanitized or complete graphs via `./hey graph export`.

Then create `workspace/$MEMBER/repos.yml` (gitignored) listing your local paths for the repos you actually work in. See [`workspace/terence/repos.yml`](../workspace/terence/repos.yml) as an example format.

---

## 5. Read the guides

- [`docs/OPERATING_GUIDE.md`](OPERATING_GUIDE.md) — daily workflow and how the system works
- [`docs/WORKFLOW_GUIDE.md`](WORKFLOW_GUIDE.md) — ceremonies (weekly sync, standups, retros)
- [`docs/FISHER_GUIDE.md`](FISHER_GUIDE.md) — how to interact with Fisher, the team AI agent on Slack

---

## 6. Try the daily commands

| Command | When to use |
| --- | --- |
| `/project:morning` | Start of day — pulls context, surfaces priorities |
| `/project:check` | During the day — quick status check |
| `/project:night` | End of day — log progress, close out |

---

## 7. Claim and work on tasks

```
/project:more
```

Use this to see available tasks and pick one up.

---

## Appendix A: Remote Access to the Mac Mini (Optional)

If you want to use the team's shared Hermes gateway on the Mac Mini (AI agent, cron pipelines, knowledge base) from your own machine:

```bash
bash scripts/remote-access-setup.sh
```

See [`docs/REMOTE_ACCESS.md`](REMOTE_ACCESS.md) for full setup, SSH key exchange, and troubleshooting.
