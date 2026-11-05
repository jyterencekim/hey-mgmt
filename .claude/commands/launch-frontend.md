Set up and launch the management frontend — both the Astro board (`apps/board/`) and the local Hono API (`apps/api/`). Use for "launch the frontend", "run the board", "open the dashboard".

**Language**: Read `LANGUAGE` from `.env` (default: `en`). Respond in this language.

1. Verify both apps exist:
   ```bash
   ls apps/board/package.json apps/api/package.json
   ```

2. Install dependencies if any `node_modules` is missing. Each app has its own lockfile — install in both. Root also has a devDep (`concurrently`).
   ```bash
   test -d node_modules || pnpm install
   test -d apps/board/node_modules || (cd apps/board && pnpm install)
   test -d apps/api/node_modules || (cd apps/api && pnpm install)
   ```
   Run installs in the background — cold caches can take a minute each.

3. Build the index so the board has data to render:
   ```bash
   ./hey index build
   ```
   This produces `index/manifest.jsonl`, which `apps/board` reads at module-eval time. The `predev` hook in `apps/board/package.json` does this too, but running it explicitly surfaces indexer errors before Astro boots.

4. Check the terminal-pane dependencies. The right-side terminal pane embeds a per-member local `claude` session via ttyd + tmux. Without them, opening the pane returns 500 — the rest of the board still works.
   ```bash
   which ttyd tmux || brew install ttyd tmux
   ```

5. Launch both apps in the background from the repo root:
   ```bash
   pnpm dev
   ```
   This runs `apps/board` (Astro dev on `http://localhost:4321`) and `apps/api` (Hono on `http://127.0.0.1:4317`) concurrently via `concurrently`. Use `run_in_background: true`. Vite proxies `/api/*` and `/terminal/*` to the api, so the browser only ever talks to `4321`. Read the background output to confirm both URLs.

6. Once both report ready, tell the user:
   - The board URL (`http://localhost:4321`) and that the api is on `127.0.0.1:4317` behind the proxy
   - Data is read once at module-eval — the `contentWatcher` Vite plugin (`apps/board/src/vite/contentWatcher.ts`) triggers a full reload when files in `workspace/` or `content/` change; edits outside that scope need a dev server restart
   - Inbox/task action buttons POST to `/api/<action>` (proxied to `apps/api` → shells out to `./hey`) and queue a git commit + push
   - The right-pane terminal opens a per-member `tmux new -A -s cc-<member> claude` that persists across browser refresh; collapse/expand via the chevron on the right edge
   - Theme defaults to dark (Linear-flavored palette); toggle from the sidebar header

7. Do not cancel the background process. Leave it running for the user.
