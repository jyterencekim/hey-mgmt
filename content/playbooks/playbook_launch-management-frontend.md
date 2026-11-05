---
id: playbook_launch-management-frontend
type: playbook
title: 'Runbook: Launching the Management Frontend'
created_at: '2026-05-19'
updated_at: '2026-05-19'
playbook_version: 0.1.0
owner: team
status: active
tags:
  - Operations
  - DeveloperExperience
  - Frontend
---

# Runbook: Launching the Management Frontend

This repo ships two local apps that together form the Team management
board: an Astro board (`apps/board`, served on `http://localhost:4321`) and a
Hono control API (`apps/api`, served on `http://127.0.0.1:4317`). The board's
Vite dev server proxies `/api/*` and `/terminal/*` to the api, so the browser
only ever talks to `4321`.

The `/launch-frontend` slash command and `pnpm dev` both wire the same flow.
This runbook captures the dependency and runtime pitfalls we have hit so
members can resolve them in one step instead of trial-and-error.

## Quick Start

```bash
pnpm install                                   # root devDeps (concurrently)
pnpm --dir apps/board install                  # board deps
pnpm --dir apps/api install                    # api deps
./hey index build                              # content/ → index/manifest.jsonl
which ttyd tmux || brew install ttyd tmux      # right-pane terminal (optional)
pnpm dev                                       # boots both apps concurrently
```

Open `http://localhost:4321`. The api logs `[hey-mgmt-api] listening on
http://127.0.0.1:4317` when ready.

## Always Reinstall — Do Not Skip Workspaces

The previous version of this flow guarded each install behind
`test -d node_modules || pnpm install`. **Do not rely on that check.** A
`node_modules/` directory can exist while still missing packages added to
`package.json` after the last install — pnpm only reconciles when invoked.
Run `pnpm install` in **all three** places on every fresh checkout and after
every pull that touches a lockfile:

- repo root (root `package.json` declares `concurrently` as a devDep used by
  the `dev` script)
- `apps/board` (declares `marked`, `@tailwindcss/typography`, and the Astro
  toolchain)
- `apps/api` (declares Hono and `tsx`)

## Known Symptoms

### `sh: concurrently: command not found`

Root `node_modules/` exists but root deps were never installed (or are stale).
Fix: `pnpm install` at the repo root.

### `[vite] Error: ... could not be resolved: marked (imported by .../islands/TaskDetail.tsx)`

`apps/board/node_modules/` exists but is missing `marked` and
`@tailwindcss/typography`. Fix: `pnpm --dir apps/board install`. Vite picks
up the new modules on the next request — no restart needed.

### `localStorage.getItem is not a function` during SSR (Astro/Node)

This is a code-side bug, not a missing dependency. Node 25+ (and some Node 22
configurations launched with `--localstorage-file`) define a partial
`localStorage` global during SSR — the `typeof localStorage === "undefined"`
guard is **not enough**. Read helpers in islands must check `window` plus a
callable `getItem` before reading. See `apps/board/src/components/islands/
RightPane.tsx` — `hasLocalStorage()` is the reference pattern.

### Right-pane terminal returns 500

The right-side terminal pane embeds a per-member `tmux new -A -s cc-<member>
claude` session via `ttyd`. Without those binaries the iframe 500s while the
rest of the board still works. Fix: `brew install ttyd tmux`.

## What Happens at Module-Eval

`apps/board` reads `index/manifest.jsonl` at module-eval time. The `predev`
hook in `apps/board/package.json` runs `./hey index build` before Astro
boots, so the manifest is fresh. The `contentWatcher` Vite plugin
(`apps/board/src/vite/contentWatcher.ts`) full-reloads the dev server when
files under `workspace/` or `content/` change. Edits outside that scope need
a manual dev-server restart.

## Action Buttons and Git Side Effects

Inbox and task action buttons POST to `/api/<action>`, which `apps/api`
proxies into `./hey`. `./hey` queues a git commit and push, so clicking
"defer" or "done" in the board produces a real commit on `main`. Treat the
local board like the CLI — every action lands in git history.

## Theme

The board defaults to a dark Linear-flavored palette; toggle from the sidebar
header. Terminal theme (`dark`/`light`) is persisted to
`localStorage["hey-mgmt-terminal-theme"]` per browser profile.
