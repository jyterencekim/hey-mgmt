import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { resolve, join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import type { InboxItem, Task, SerializedTask } from "./types.js"
import { repoRoot, toVsCodeHref } from "./repo.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(__dirname, "../../../../workspace")

// ── Member scanning ─────────────────────────────────────────────

/**
 * List all member names by scanning workspace/ directory.
 * (v2/R1) Filters out dotfiles (.DS_Store etc.) and non-directory entries.
 */
export function listMembers(): string[] {
  if (!existsSync(workspaceRoot)) return []
  return readdirSync(workspaceRoot)
    .filter(
      (entry) =>
        !entry.startsWith(".") &&
        statSync(join(workspaceRoot, entry)).isDirectory()
    )
    .sort()
}

// Non-human workspaces excluded from the sidebar Team list and Inbox member chips.
// Current member is always included.
export const NON_HUMAN_WORKSPACES = new Set(["fisher", "agent", "team"])

export function listCoreTeam(current?: string): string[] {
  return listMembers().filter(
    (m) => !NON_HUMAN_WORKSPACES.has(m) || (current && m === current)
  )
}

export const CORE_TEAM = new Set(listCoreTeam())

/**
 * Resolve the current member from MEMBER env var.
 * Throws if unset — silent fallback to a hardcoded name causes the board to
 * impersonate that member for everyone else (the previous "charlie" default
 * shipped this exact regression).
 */
export function getCurrentMember(): string {
  const member =
    (typeof process !== "undefined" && process.env.MEMBER) ||
    (typeof import.meta !== "undefined" &&
      (import.meta as unknown as { env?: Record<string, string> }).env
        ?.MEMBER)
  if (!member) {
    throw new Error(
      "MEMBER is not set. Add MEMBER=<your-name> to .env at the repo root, " +
        "or export it before running the dev server. The board cannot guess " +
        "without silently impersonating someone.",
    )
  }
  return member
}

// ── Task serialization (v3/C1) ──────────────────────────────────

/**
 * Project a full Task into the trimmed SerializedTask shape.
 * Used to keep /tasks/index.html under the page-weight budget.
 */
export function toSerializedTask(task: Task): SerializedTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    iteration: task.iteration,
    area: task.area,
    due_date: task.due_date,
    updated_at: task.updated_at,
    relations_out: task.relations_out ?? [],
    tags: task.tags ?? [],
    path: task.path,
    vscodeHref: toVsCodeHref(task.path),
  }
}

// ── Inbox loading ───────────────────────────────────────────────

/**
 * Load inbox items for a single member from disk.
 * Reads JSON files from workspace/{member}/inbox/{open,read,discarded}/.
 *
 * (v2/R2) Every readdirSync is guarded by existsSync.
 * Missing inbox/ or any subdirectory returns empty array, never throws.
 */
export function loadInboxFor(member: string): InboxItem[] {
  const inboxDir = join(workspaceRoot, member, "inbox")
  if (!existsSync(inboxDir)) return []

  const items: InboxItem[] = []
  for (const bucket of ["open", "read", "discarded"] as const) {
    const bucketDir = join(inboxDir, bucket)
    if (!existsSync(bucketDir)) continue
    for (const file of readdirSync(bucketDir)) {
      if (!file.endsWith(".json")) continue
      const absolutePath = join(bucketDir, file)
      try {
        const raw = JSON.parse(readFileSync(absolutePath, "utf-8"))
        const path = relative(repoRoot, absolutePath)
        items.push({
          ...raw,
          status: bucket,
          path,
          vscodeHref: toVsCodeHref(path),
        })
      } catch {
        // Malformed JSON — skip silently
      }
    }
  }
  return items
}

/**
 * Load inbox for all members. Returns a Map<member, InboxItem[]>.
 */
export function loadAllInbox(): Map<string, InboxItem[]> {
  const result = new Map<string, InboxItem[]>()
  for (const member of listMembers()) {
    result.set(member, loadInboxFor(member))
  }
  return result
}

/**
 * Count open inbox items per member. Returns Map<member, number>.
 */
export function countOpenInbox(): Map<string, number> {
  const result = new Map<string, number>()
  for (const member of listMembers()) {
    const items = loadInboxFor(member)
    result.set(member, items.filter((i) => i.status === "open").length)
  }
  return result
}
