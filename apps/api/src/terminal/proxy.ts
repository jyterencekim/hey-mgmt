import httpProxy from "http-proxy"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"
import { ensureTtyd } from "./manager.js"

const proxy = httpProxy.createProxyServer({ ws: true })

// Strip headers that would block embedding the terminal in our iframe.
// ttyd doesn't ship them today but defending against an upstream change.
// Also add aggressive caching for ttyd's static assets — the iframe is
// reloaded on every page navigation (Astro+iframe limit), so caching the
// HTML/JS makes the reload near-instant.
proxy.on("proxyRes", (proxyRes, req) => {
  delete proxyRes.headers["x-frame-options"]
  delete proxyRes.headers["content-security-policy"]
  const url = req.url ?? ""
  // ttyd's index is /, its JS bundle has a stable filename. Skip the WS
  // upgrade and any /token endpoints (auth-related, must stay fresh).
  if (url === "/" || /\.(js|css|woff2?|ttf|png|svg|ico)(\?|$)/.test(url)) {
    proxyRes.headers["cache-control"] = "private, max-age=300, must-revalidate"
  }
})

proxy.on("error", (err, _req, target) => {
  console.error("[terminal proxy] error:", err.message)
  if (target && "writeHead" in target && !target.headersSent) {
    try {
      target.writeHead(502, { "content-type": "application/json" })
      target.end(
        JSON.stringify({ error: "Terminal proxy upstream error", detail: err.message })
      )
    } catch {
      /* socket likely already destroyed */
    }
  } else if (target && "destroy" in target) {
    try {
      target.destroy()
    } catch {
      /* best-effort */
    }
  }
})

const TERMINAL_PATH = /^\/terminal\/([a-z0-9_-]+)(\/.*)?$/

export function isTerminalPath(url: string): boolean {
  return TERMINAL_PATH.test(url)
}

function parsePath(url: string): { member: string; tail: string } | null {
  const m = url.match(TERMINAL_PATH)
  if (!m) return null
  const member = m[1]
  const tail = m[2] && m[2].length > 0 ? m[2] : "/"
  return { member, tail }
}

async function targetFor(member: string): Promise<string> {
  const session = await ensureTtyd(member)
  return `http://127.0.0.1:${session.port}`
}

export async function handleTerminalHttp(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const parsed = parsePath(req.url ?? "")
  if (!parsed) {
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ error: "invalid terminal path" }))
    return
  }
  let target: string
  try {
    target = await targetFor(parsed.member)
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" })
    res.end(
      JSON.stringify({
        error: "could not start terminal",
        detail: (err as Error).message,
      })
    )
    return
  }
  // Rewrite path: strip /terminal/<member> so ttyd sees the root path.
  req.url = parsed.tail
  proxy.web(req, res, { target })
}

export async function handleTerminalUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): Promise<void> {
  const parsed = parsePath(req.url ?? "")
  if (!parsed) {
    socket.destroy()
    return
  }
  let target: string
  try {
    target = await targetFor(parsed.member)
  } catch {
    socket.destroy()
    return
  }
  req.url = parsed.tail
  proxy.ws(req, socket, head, { target })
}
