import { DatabaseSync } from "node:sqlite"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { repoRoot } from "./env.js"

export type SearchResult = {
  id: string
  type: string
  title: string
  path: string
  status: string | null
  priority: string | null
  owner: string | null
  updated_at: string
}

let db: DatabaseSync | null = null

function getDb(): DatabaseSync | null {
  if (db) return db
  const dbPath = join(repoRoot, ".hey", "catalog.sqlite")
  if (!existsSync(dbPath)) return null
  db = new DatabaseSync(dbPath, { readOnly: true })
  return db
}

const TYPE_PRIORITY: Record<string, number> = {
  task: 0,
  decision: 1,
  initiative: 2,
  note: 3,
  playbook: 4,
  meeting: 5,
}

export function searchItems(query: string, limit = 20): SearchResult[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const handle = getDb()
  if (!handle) return []
  const like = `%${trimmed}%`
  const stmt = handle.prepare(`
    SELECT id, type, title, path, status, priority, owner, updated_at
    FROM items
    WHERE title LIKE ? OR id LIKE ?
    ORDER BY updated_at DESC
    LIMIT ?
  `)
  const rows = stmt.all(like, like, Math.max(1, Math.min(100, limit))) as SearchResult[]
  // Stable secondary sort: keep updated_at-desc but lift tasks ahead of
  // same-day notes/playbooks since they're usually what people are after.
  return rows.sort((a, b) => {
    if (a.updated_at !== b.updated_at) return 0
    const pa = TYPE_PRIORITY[a.type] ?? 99
    const pb = TYPE_PRIORITY[b.type] ?? 99
    return pa - pb
  })
}
