import { spawn, type ChildProcess } from "node:child_process"
import { createConnection, createServer } from "node:net"
import { repoRoot } from "../env.js"

export type TerminalSession = {
  member: string
  port: number
  pid: number
  startedAt: number
}

type InternalSession = TerminalSession & { proc: ChildProcess }

const sessions = new Map<string, InternalSession>()

// Member names live under workspace/<member>/; restrict to safe shell-free chars.
const VALID_MEMBER = /^[a-z0-9_-]{1,32}$/

function isValidMember(member: string): boolean {
  return VALID_MEMBER.test(member)
}

async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.unref()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      if (addr && typeof addr === "object") {
        const port = addr.port
        s.close(() => resolve(port))
      } else {
        s.close(() => reject(new Error("could not determine free port")))
      }
    })
  })
}

async function waitForPortReady(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  let step = 25
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = createConnection({ host: "127.0.0.1", port }, () => {
        sock.end()
        resolve(true)
      })
      sock.once("error", () => resolve(false))
      sock.setTimeout(200, () => {
        sock.destroy()
        resolve(false)
      })
    })
    if (ok) return
    await new Promise<void>((r) => setTimeout(r, step))
    step = Math.min(step * 2, 200)
  }
  throw new Error(
    `ttyd did not start listening on 127.0.0.1:${port} within ${timeoutMs}ms`
  )
}

function isAlive(proc: ChildProcess): boolean {
  return !proc.killed && proc.exitCode === null
}

export async function ensureTtyd(member: string): Promise<TerminalSession> {
  if (!isValidMember(member)) {
    throw new Error(`invalid member: ${member}`)
  }

  const existing = sessions.get(member)
  if (existing && isAlive(existing.proc)) {
    return toPublic(existing)
  }

  // Note: we do NOT pass xterm.js options (fontSize, theme, etc.) via -t.
  // ttyd's -t flag only feeds its own clientOptions whitelist (titleFixed,
  // disableLeaveAlert, etc.); xterm options are NOT in that whitelist and
  // get silently ignored. The board injects fontSize and theme directly
  // into the iframe's `term.options` after load — see RightPane.tsx.
  const port = await findFreePort()
  const tmuxSession = `cc-${member}`

  const proc = spawn(
    "ttyd",
    [
      "-p",
      String(port),
      "-i",
      "127.0.0.1",
      "-W",
      "-t",
      "titleFixed=claude",
      "-t",
      "disableLeaveAlert=true",
      // Suppresses xterm.js's "WxH" overlay when we trigger fit() on
      // navigation. Without it, every page swap briefly flashes the
      // size badge over the terminal.
      "-t",
      "disableResizeOverlay=true",
      // Use the canvas renderer instead of WebGL. WebGL loses its
      // rendering context during Astro view-transition reflows, which
      // makes the terminal go black on navigation until fit() forces a
      // resize. Canvas survives the reflow without help.
      "-t",
      "rendererType=canvas",
      "--",
      "tmux",
      "new-session",
      "-A",
      "-s",
      tmuxSession,
      "claude",
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, MEMBER: member },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  proc.on("exit", (code, signal) => {
    console.info(
      `[terminal] ttyd for ${member} exited code=${code} signal=${signal}`
    )
    const current = sessions.get(member)
    if (current && current.proc === proc) sessions.delete(member)
  })

  try {
    await waitForPortReady(port, 3000)
  } catch (err) {
    try {
      proc.kill("SIGTERM")
    } catch {
      /* best-effort */
    }
    if (!isAlive(proc)) {
      throw new Error(
        "ttyd did not start. Is it installed? On macOS: `brew install ttyd tmux`."
      )
    }
    throw err
  }

  const session: InternalSession = {
    member,
    port,
    pid: proc.pid ?? 0,
    startedAt: Date.now(),
    proc,
  }
  sessions.set(member, session)
  return toPublic(session)
}

function toPublic(s: InternalSession): TerminalSession {
  return {
    member: s.member,
    port: s.port,
    pid: s.pid,
    startedAt: s.startedAt,
  }
}

export function listSessions(): TerminalSession[] {
  return [...sessions.values()].map(toPublic)
}

export function killAllSessions(): void {
  for (const s of sessions.values()) {
    try {
      s.proc.kill("SIGTERM")
    } catch {
      /* best-effort */
    }
  }
  sessions.clear()
}

// Best-effort cleanup on api shutdown so we don't leak tmux+claude trees.
process.on("SIGINT", () => {
  killAllSessions()
  process.exit(0)
})
process.on("SIGTERM", () => {
  killAllSessions()
  process.exit(0)
})
process.on("exit", () => {
  killAllSessions()
})
