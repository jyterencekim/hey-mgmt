import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(__dirname, "../../../../workspace")

const LOG_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/

export type LogEntry = {
  member: string
  date: string
  path: string
  size: number
}

function logsDir(member: string): string {
  return join(workspaceRoot, member, "logs")
}

export function listLogs(member: string): LogEntry[] {
  const dir = logsDir(member)
  if (!existsSync(dir)) return []
  const out: LogEntry[] = []
  for (const entry of readdirSync(dir)) {
    const m = entry.match(LOG_NAME)
    if (!m) continue
    const abs = join(dir, entry)
    let size = 0
    try {
      size = statSync(abs).size
    } catch {
      /* skip stat failures */
    }
    out.push({
      member,
      date: m[1],
      path: `workspace/${member}/logs/${entry}`,
      size,
    })
  }
  // Reverse-chronological.
  out.sort((a, b) => b.date.localeCompare(a.date))
  return out
}

export function readLog(member: string, date: string): string | null {
  if (!LOG_NAME.test(`${date}.md`)) return null
  const abs = join(logsDir(member), `${date}.md`)
  if (!existsSync(abs)) return null
  return readFileSync(abs, "utf8")
}
