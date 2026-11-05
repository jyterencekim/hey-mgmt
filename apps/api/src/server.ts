import { getRequestListener } from "@hono/node-server"
import { createServer } from "node:http"
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { HOST, PORT, loadDotenv, repoRoot } from "./env.js"
import { fetchRecentEvents } from "./pulse.js"
import { handleRepoAction } from "./repo/handler.js"
import { searchItems } from "./search.js"
import {
  handleTerminalHttp,
  handleTerminalUpgrade,
  isTerminalPath,
} from "./terminal/proxy.js"
import { listSessions } from "./terminal/manager.js"

loadDotenv()

const app = new Hono()

app.get("/health", (c) =>
  c.json({
    ok: true,
    repoRoot,
    member: process.env.MEMBER ?? null,
    terminal_sessions: listSessions(),
    ts: new Date().toISOString(),
  })
)

// Search across items in .hey/catalog.sqlite.
app.get("/search", (c) => {
  const q = c.req.query("q") ?? ""
  const limit = Number(c.req.query("limit") ?? 20)
  try {
    const results = searchItems(q, Number.isFinite(limit) ? limit : 20)
    return c.json({ ok: true, query: q, results })
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500)
  }
})

// Repo actions — POST /api/<action>.
app.post("/api/*", async (c) => {
  const url = new URL(c.req.url)
  const action = url.pathname.slice("/api/".length).split("?")[0] ?? ""
  return handleRepoAction(c, action)
})

// Pulse — Server-Sent Events stream of recent commits touching content/ or
// workspace/. On connect we replay the last 24 hours (up to 400 commits) as a
// "backlog" event, then poll git every 10s for newer commits and emit them
// as "events". The board groups them by member and folds bot commits.
// Route lives at /pulse-stream (not /pulse) so it doesn't collide with the
// board's /pulse/ page route through the Vite proxy.
app.get("/pulse-stream", (c) =>
  streamSSE(c, async (stream) => {
    const initial = await fetchRecentEvents(400, "24 hours ago")
    await stream.writeSSE({
      event: "backlog",
      data: JSON.stringify({ events: initial }),
    })
    let lastTs = initial[0]?.ts ?? new Date().toISOString()
    while (!stream.aborted && !stream.closed) {
      await stream.sleep(10_000)
      try {
        const newer = await fetchRecentEvents(50, lastTs)
        // Drop commits at the same timestamp as our cursor (git --since= is
        // inclusive at second granularity; without this we'd re-emit them).
        const fresh = newer.filter((e) => e.ts > lastTs)
        if (fresh.length > 0) {
          await stream.writeSSE({
            event: "events",
            data: JSON.stringify({ events: fresh }),
          })
          lastTs = fresh[0].ts
        }
      } catch (err) {
        console.warn("[pulse] git log failed:", (err as Error).message)
      }
    }
  })
)

// /terminal/* is handled below by raw http proxy, NOT by Hono — see server.

const honoListener = getRequestListener(app.fetch)

const server = createServer((req, res) => {
  const url = req.url ?? ""
  if (isTerminalPath(url)) {
    handleTerminalHttp(req, res).catch((err) => {
      console.error("[terminal http]", err)
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: "terminal handler failed" }))
      }
    })
    return
  }
  honoListener(req, res)
})

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? ""
  if (isTerminalPath(url)) {
    handleTerminalUpgrade(req, socket, head).catch((err) => {
      console.error("[terminal ws]", err)
      socket.destroy()
    })
    return
  }
  // No other upgrade routes today — close politely.
  socket.destroy()
})

server.listen(PORT, HOST, () => {
  console.log(`[hey-api] listening on http://${HOST}:${PORT}`)
  console.log(`[hey-api] repoRoot=${repoRoot}`)
})
