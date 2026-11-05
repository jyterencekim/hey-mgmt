import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { repoRoot } from "./env.js"

const execFileAsync = promisify(execFile)

export type PulseFile = {
  path: string
  id: string // artifact id (filename without .md) or the bare filename
  title: string | null // frontmatter title when the file still exists
}

export type PulseEvent = {
  id: string // short commit hash
  ts: string // ISO time
  actor: string // author name
  member: string | null // members.yml name the author maps to
  bot: boolean // automated commit (Fisher, CI)
  subject: string // commit message subject
  files: PulseFile[]
}

// Git author identities → members.yml names. Matched on email first, then
// on author name; anything unmapped shows under its raw author name.
const AUTHOR_EMAILS: Record<string, string> = {
  "alice@example.com": "alice",
  "bob@example.com": "bob",
}
const AUTHOR_NAMES: Record<string, string> = {
  alice: "alice",
  bob: "bob",
}
// Automated writers: Fisher and CI bots.
const BOT_EMAIL = /@hey-fisher\.local$|\[bot\]@|noreply@github\.com$/i
const BOT_NAMES = new Set(["hey-mgmt", "fisher", "agent", "github-actions"])

function resolveAuthor(name: string, email: string) {
  const bot = BOT_EMAIL.test(email) || BOT_NAMES.has(name.toLowerCase())
  const member =
    AUTHOR_EMAILS[email.toLowerCase()] ??
    AUTHOR_NAMES[name.toLowerCase()] ??
    null
  return { bot, member: bot ? null : member }
}

// Title lookups are cached per path; artifacts rarely get renamed.
const titleCache = new Map<string, string | null>()

async function readTitle(path: string): Promise<string | null> {
  if (titleCache.has(path)) return titleCache.get(path) ?? null
  let title: string | null = null
  if (path.endsWith(".md")) {
    try {
      const head = (await readFile(join(repoRoot, path), "utf-8")).slice(0, 4000)
      const m = head.match(/^title:[ \t]*(.*)$/m)
      if (m) {
        let raw = m[1].trim()
        // Folded/literal block scalar (title: >-) — join the indented lines.
        if (/^[>|][-+]?$/.test(raw)) {
          const after = head.slice((m.index ?? 0) + m[0].length + 1)
          raw = (after.match(/^(?:[ \t]+.*(?:\n|$))+/)?.[0] ?? "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .join(" ")
        }
        title = raw.replace(/^(['"])(.*)\1$/, "$2") || null
      }
    } catch {
      // Deleted or moved since the commit.
    }
  }
  titleCache.set(path, title)
  return title
}

const SEP = "\x1e"

/**
 * Read recent commits touching content/ or workspace/ (the canonical
 * artifact dirs), with the files each one changed. Reverse-chronological.
 * `since` is forwarded to git's --since= and accepts ISO timestamps or
 * relative ("24 hours ago").
 */
export async function fetchRecentEvents(
  limit = 50,
  since?: string
): Promise<PulseEvent[]> {
  const args = [
    "log",
    `-n${Math.max(1, Math.min(500, limit))}`,
    "--no-merges",
    "--name-only",
    `--format=${SEP}%h%x09%aI%x09%an%x09%ae%x09%s`,
  ]
  if (since) args.push(`--since=${since}`)
  args.push("--", "content", "workspace")

  const { stdout } = await execFileAsync("git", args, {
    cwd: repoRoot,
    maxBuffer: 32 * 1024 * 1024,
  })

  const events: PulseEvent[] = []
  for (const block of stdout.split(SEP)) {
    const [header, ...rest] = block.split("\n")
    if (!header?.trim()) continue
    const [id, ts, actor, email, subject] = header.split("\t")
    const paths = rest
      .map((l) => l.trim())
      .filter((p) => p.startsWith("content/") || p.startsWith("workspace/"))
    const files = await Promise.all(
      paths.map(async (path) => ({
        path,
        id: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
        title: await readTitle(path),
      }))
    )
    events.push({
      id,
      ts,
      actor,
      ...resolveAuthor(actor, email ?? ""),
      subject,
      files,
    })
  }
  return events
}
