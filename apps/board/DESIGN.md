# Board — Design & Implementation Notes

Companion to `README.md`. README tells you *how to run it*; this tells you *why it is shaped the way it is* and records non-obvious implementation details. Update this file when you change the rendering model, the data pipeline, or the dev-only mutation surface.

## Architecture snapshot

```
index/manifest.jsonl ──┐
                       ├─► src/lib/{manifest.ts, workspace.ts}
workspace/*/inbox/* ───┘                │
                                         ▼
                         src/pages/**/*.astro   (SSG, rendered at build & dev)
                           ├── static HTML
                           └── <astro-island>   (React: TaskFilter, ActionButton)

      Dev only (apply: "serve"):
      /api/*  ──► src/dev-api/plugin.ts (Vite middleware)
                   └── src/dev-api/handlers.ts ──execFile──► ./hey  (repo root)
```

Two separate flows:
- **Read path**: `./hey index build` regenerates `index/manifest.jsonl` (gitignored). Pages read it at module-eval during `astro build` (emitting static HTML) and during `astro dev` (per-request for the page frontmatter, but each loader call re-reads from disk — no in-process cache beyond what Vite does).
- **Write path**: only exists in `astro dev`. Action buttons POST to `/api/*`; the Vite plugin shells `./hey <subcommand>` via `execFile`; on success the button reloads the page. In `astro build` the plugin is inert (`apply: "serve"`) and no server code ships.

## File layout

```
apps/board/
  astro.config.mjs              # registers heyApiPlugin() under vite.plugins
  DESIGN.md                     # this file
  README.md                     # usage + route table
  src/
    layouts/main.astro
    lib/
      manifest.ts               # reads index/manifest.jsonl on each call
      workspace.ts              # reads workspace/{member}/inbox/{open,read,discarded}/*.json per call
      iterations.ts, repo.ts, types.ts
    components/
      InboxItem.astro, TaskTable.astro, TaskRow.astro, PriorityBadge.astro, StatusBadge.astro, ...
      islands/
        TaskFilter.tsx          # /tasks/ filtering & sorting (URL-params state)
        ActionButton.tsx        # single button → POST /api/* → reload
    dev-api/
      handlers.ts               # whitelisted ACTIONS map + runAction(); shells ./hey via execFile
      plugin.ts                 # vite plugin w/ configureServer middleware at /api/*
    pages/
      index.astro                       # dashboard
      tasks/index.astro, tasks/[id].astro, tasks/data.json.ts
      iterations/index.astro, iterations/[week].astro
      inbox/index.astro, inbox/[member].astro
      me/[member].astro                  # three-tab personal view (see below)
```

## Rendering model

**SSG first.** All pages prerender. The only client-side JS is:
1. `TaskFilter` — URL-param-driven filter/sort table for `/tasks/`.
2. `ActionButton` — one-click mutations (dev-only target).
3. An inline `<script is:inline>` on `/me/[member]/` that toggles tab visibility from `?view=`.

No SPA, no client router. New interactivity should first consider an Astro island.

### `/me/[member]/` tab switching (inline script, no island)

Static HTML contains all three `<section data-view="tasks|iteration|inbox">` blocks. Nav links use `data-view-link="..."` and `href="?view=..."`. On load an inline script reads `window.location.search`, hides non-matching sections, and toggles the active-class on the matching nav link. `popstate` re-applies on back/forward navigation.

Why not SSR? Because `Astro.url.searchParams` is evaluated at build time for static pages, so `?view=inbox` used to serve the default (tasks) HTML — that was the bug the current design fixes. Query params drive client-side visibility, not server-side branching.

## Data staleness

Writes made *through* the board (ActionButton → API) trigger `location.reload()` on success. For task/promote actions the handler also runs `./hey index build` before returning so the reload sees a fresh manifest.

Writes made *outside* the board (direct edits, CLI from another terminal) are NOT observed. `astro dev` reads are cached at the Vite module graph level for the page module itself; loaders read from disk each call but the frontmatter is only re-executed on request, not on file change. Restart `astro dev` when in doubt. Adding an FS watcher was considered and rejected for now (complexity > benefit).

## Dev-only mutation API

### Why an Astro Vite plugin, not…

- **an Astro API route with `prerender = false`** — would require an adapter (`@astrojs/node`) and make `astro build` emit server artifacts that must be ignored. Breaks the "pure SSG output" promise.
- **a sidecar process on a separate port** — works but needs concurrent process management (`concurrently`) and CORS configuration. Extra moving parts.
- **a Vite middleware plugin with `apply: "serve"`** — attaches to Astro's existing dev server, same origin, dev-only by construction, zero impact on `astro build`. Chosen.

### Request contract

- Method: `POST`
- Content-Type: `application/json`
- Body: JSON object mapping param names to strings
- Body cap: 256 KB (`readJsonBody` rejects larger payloads and destroys the socket)
- Response: `{ ok: true, stdout }` on success, `{ ok: false, error }` on failure (HTTP 4xx)

### Safety posture

- **Whitelist, not router**: `ACTIONS` in `handlers.ts` enumerates exactly six keys (`inbox/{ack,discard,promote}`, `task/{ack,complete,fail}`). Anything else → 404.
- **Per-param flag map**: each action declares `[{param, flag, required?}]`. The handler iterates the spec, never the input. Unknown request keys are ignored.
- **No shell**: `execFile("./hey", [...argv])` — argv is an array, never a string. Even if someone sends `{ task: "; rm -rf /" }`, it becomes a single argv element passed to `./hey work complete`, which just reports "Task not found".
- **Dev-only by attachment**: the plugin sets `apply: "serve"` and registers a Vite `configureServer` hook. Neither fires during `astro build` — production static HTML has no `/api/*` surface.

### Adding a new action

1. Append a new entry to `ACTIONS` in `src/dev-api/handlers.ts` with the `./hey` subcommand argv and per-param flags.
2. Render an `<ActionButton>` with the matching `endpoint` and `params`. Use `noteField` if the action accepts a free-text flag; add `noteRequired` when the CLI marks it required. Use `confirm` for destructive actions.
3. That's it — no route file, no island to touch. Typecheck and reload.

If the action mutates data that flows through `index/manifest.jsonl`, set `rebuildIndex: true` so the following page reload sees fresh task state. Inbox moves don't need rebuild (the board reads inbox JSONs directly, not via manifest).

### Error surfacing

On a non-2xx response the button shows the `error` field inline in red. The server forwards the CLI's exact stderr/stdout, so validation failures and "not found" messages are legible without opening devtools. Known case: `./hey task ack` / `work complete` / `work fail` run `buildIndexes(repoRoot)` first (see `scripts/hey.mjs:651`), which validates the whole repo. A single out-of-vocab tag anywhere will block every task mutation until fixed.

## ActionButton states

```
idle ──click──► (noteField set?)
                │ yes → prompt   (textarea + Confirm/Cancel)
                │ no  → (confirm?)
                │        │ yes → window.confirm → submit
                │        │ no  → submit
                ▼
              busy ──fetch──► success → window.location.reload()
                              failure → error  (inline red, revert to idle on next click)
```

Note is sent as `{ [noteField]: value }` and dropped when empty unless `noteRequired`. Required-but-empty triggers a client-side validation message without firing the request.

## Deletability

The "rm -rf apps/" promise holds. `./hey` is self-contained under `scripts/`, `index/manifest.jsonl` is regenerable, and no core artifact imports anything under `apps/board/`. The Vite plugin's only coupling to the core is `execFile("./hey", ..., { cwd: repoRoot })` — removing the board removes the UI; the CLI keeps working.
