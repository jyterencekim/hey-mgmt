# @hey-mgmt/api

Local-only HTTP service for the mgmt board frontend.

- `pnpm dev` — start in watch mode (tsx watch)
- `pnpm start` — start once
- Default address: `http://127.0.0.1:4317` (override via `hey-mgmt_API_HOST` / `hey-mgmt_API_PORT`)

Phase 0 ships the skeleton only. Real endpoints land in later phases:

- Phase 2: `/repo/*` — task / inbox / doc writes via `./hey`
- Phase 3: `/terminal/*` — ttyd reverse proxy for in-browser claude
- Phase 4: `/pulse` — SSE activity stream

The service binds to loopback (`127.0.0.1`) only — never expose to the network.
