# apps/board

## What it is

The mgmt frontend — an Astro app with a collapsible sidebar (Pulse / Inbox / My tasks / Team tasks / Iterations / Docs / Graph / Settings), a main content area, and a right-side terminal pane that embeds a local `claude` session via ttyd.

Periphery plugin: the core (`content/`, `scripts/`, `index/`) works fully without it.

## Companion: apps/api

The board pairs with a small local Hono service at [`apps/api/`](../api/) (default `http://127.0.0.1:4317`) for:

- **Repo writes** — `POST /api/<action>` shells out to `./hey` and queues a git commit + push (the dev-api Vite middleware that used to live here has been retired)
- **Terminal proxy** — `/terminal/<member>/` reverse-proxies HTTP + WebSocket to a per-member `ttyd ... -- tmux new -A -s cc-<member> claude`

Both surfaces are reached via Vite's `server.proxy`, so the browser only ever talks to one origin (`localhost:4321`).

## Deletability

`rm -rf apps/` leaves the core repo fully operational — by design. No core script depends on either app.

## Dev loop

From the repo root:

```bash
pnpm dev          # board + api together (default)
pnpm frontend     # board only
pnpm api          # api only
```

The `predev` hook in this app stops stale board dev servers on `4321/4322`, then runs `./hey index build` before Vite. If a stale cache or dev server gets in the way:

```bash
pnpm run dev:clean    # kill stale + wipe node_modules/.vite + .astro
pnpm run dev:fresh    # rebuild index then start Astro
```

## Terminal pane

The right pane embeds a per-member ttyd iframe at `/terminal/<member>/`. On macOS:

```bash
brew install ttyd tmux
```

Without ttyd/tmux the rest of the board still works; only the terminal pane shows a 500.

Each member gets a persistent tmux session named `cc-<member>`. Refreshing the iframe reattaches that session, so the `claude` conversation survives reload. Restarting `apps/api` kills the ttyd process but tmux keeps the session alive — the next iframe load spawns a fresh ttyd that re-attaches.

## Theme

Dark by default (Linear-flavored: `oklch(0.20 0.004 285)` background, `oklch(0.65 0.20 280)` purple accent). Light mode uses the shadcn warm-neutral defaults. Toggle from the sidebar header — the no-flash inline script in `src/layouts/main.astro` reads `localStorage["hey-mgmt-theme"]` before paint.

## Staleness note

Markdown / JSON edits do NOT hot-reload Astro modules — data is read once at Vite module-evaluation time. The `contentWatcher` plugin (`src/vite/contentWatcher.ts`) watches `workspace/` + `content/` and triggers a full page reload on change. For edits outside that scope, restart the dev server.

## Data source

`../../index/manifest.jsonl` produced by `scripts/lib/indexer.mjs` and consumed by `src/lib/manifest.ts` at module-evaluation time. Missing → centered "build the index" page renders instead of empty views.

## Routes

| Route | Description |
|---|---|
| `/` | Dashboard: stat cards, current iteration tasks by owner, my attention list |
| `/pulse/` | Activity feed (Phase 4 — currently stub) |
| `/inbox/`, `/inbox/[member]/`, `/inbox/[member]/[id]` | Inbox index, per-member view, item detail |
| `/tasks/`, `/tasks/[id]/`, `/tasks/data.json` | Filterable task table + detail + JSON endpoint |
| `/iterations/`, `/iterations/[week]/` | Iteration index + per-week breakdown |
| `/me/[member]/` | Personal view: tasks by priority, iteration workload, inbox |
| `/docs/` | Docs index (Phase 4 — currently stub) |
| `/settings/` | Settings: current member, iteration, members list |
| `/graph/` | Cytoscape task relationship graph |
| `/artifacts/[id]/` | Generic artifact view |

## React islands

- `ThemeToggle` — sidebar header sun/moon button, persists to `localStorage`
- `RightPane` — collapsible terminal pane housing the ttyd iframe
- `TaskFilter` — table filtering and sorting (URL-synced)
- `TaskActions`, `InboxActions` — POST to `/api/<action>` (proxied to `apps/api`)
- `TaskDetail`, `TaskGraph/*` — detail / graph interactivity
- `ActionButton` — shell used by the action islands

## Local editor links

Task rows and inbox items include `vscode://file/...` links built from repo-local absolute paths. Local use only.
