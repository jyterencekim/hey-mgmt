// ⚠️ STALENESS NOTE (v2/R9): Data is read once at Vite module-evaluation
// time during `astro dev`. Changing manifest.jsonl or workspace files on
// disk does NOT trigger a hot-reload. Restart `astro dev` or re-run prebuild.

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type {
  Task,
  Initiative,
  Goal,
  GoalDetail,
  ManifestEntry,
} from "./types.js"
import { toRepoAbsolutePath } from "./repo.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const manifestPath = resolve(__dirname, "../../../../index/manifest.jsonl")

// (v3/C3a) Warn once per process — not on every call.
let _warnedMissing = false

function readManifest(): ManifestEntry[] {
  if (!existsSync(manifestPath)) {
    if (!_warnedMissing) {
      console.warn(
        "[board] index/manifest.jsonl missing — run 'pnpm run dev' (which runs prebuild) or './hey index build'"
      )
      _warnedMissing = true
    }
    return []
  }
  return readFileSync(manifestPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ManifestEntry)
}

export function getManifestStatus(): { exists: boolean; path: string } {
  return { exists: existsSync(manifestPath), path: manifestPath }
}

export function readArtifactMarkdown(path: string): {
  absolutePath: string
  frontmatter: string
  body: string
} {
  const absolutePath = toRepoAbsolutePath(path)
  if (!existsSync(absolutePath)) {
    return { absolutePath, frontmatter: "", body: "" }
  }

  const raw = readFileSync(absolutePath, "utf8")
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return { absolutePath, frontmatter: "", body: raw }
  }

  return {
    absolutePath,
    frontmatter: match[1] ?? "",
    body: raw.slice(match[0].length),
  }
}

export function loadTasks(): Task[] {
  return readManifest().filter((e): e is Task => e.type === "task")
}

export function loadInitiatives(): Initiative[] {
  return readManifest().filter((e): e is Initiative => e.type === "initiative")
}

export function loadGoals(): Goal[] {
  return readManifest().filter((e): e is Goal => e.type === "goal")
}

export function loadAll(): ManifestEntry[] {
  return readManifest()
}

/**
 * One initiative and its child tasks (via `parent_of` relations), grouped
 * under the goal it contributes to.
 */
export type InitiativeRollup = {
  initiative: Initiative
  tasks: Task[]
}

/**
 * A goal, the goal-specific detail fields read from its frontmatter, and the
 * initiatives that contribute to it (each with its own child tasks).
 */
export type GoalRollup = {
  goal: Goal
  detail: GoalDetail
  initiatives: InitiativeRollup[]
}

/**
 * Read a scalar field from a raw YAML frontmatter string. Frontmatter here is
 * simple `key: value` lines; the board has no YAML dependency, so we match the
 * top-level key directly rather than pulling in a parser. Strips surrounding
 * quotes and returns null when the field is absent or empty.
 */
function readFrontmatterScalar(
  frontmatter: string,
  key: string
): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, "m")
  const match = frontmatter.match(re)
  if (!match) return null
  const raw = (match[1] ?? "").trim().replace(/^["']|["']$/g, "")
  return raw === "" ? null : raw
}

function readGoalDetail(goal: Goal): GoalDetail {
  const { frontmatter } = readArtifactMarkdown(goal.path)
  return {
    target: readFrontmatterScalar(frontmatter, "target"),
    metric: readFrontmatterScalar(frontmatter, "metric"),
    current: readFrontmatterScalar(frontmatter, "current"),
    target_date: readFrontmatterScalar(frontmatter, "target_date"),
  }
}

/**
 * Build a goals rollup: for each goal, find initiatives whose `relations_out`
 * contains `{ type: 'contributes_to', target: goal.id }`, and for each such
 * initiative its child tasks (`parent_of` UNION task `child_of`).
 * Reads the manifest once and resolves everything against it.
 */
/**
 * Wrap an initiative with its child tasks, resolving task ids against the
 * shared task map. Membership is the UNION of initiative `parent_of` and task
 * `child_of`, matching `./hey initiative check` and the weekly report (both
 * directions are live in the ledger; one alone undercounts). Shared by
 * `goalRollups` and `roadmapData` so both use identical task-join logic.
 */
function rollupInitiative(
  initiative: Initiative,
  tasksById: Map<string, Task>,
  childrenByInitiative: Map<string, Task[]>
): InitiativeRollup {
  const seen = new Set<string>()
  const tasks: Task[] = []
  const add = (t: Task | undefined) => {
    if (!t || seen.has(t.id)) return
    seen.add(t.id)
    tasks.push(t)
  }
  for (const r of initiative.relations_out) {
    if (r.type === "parent_of") add(tasksById.get(r.target))
  }
  for (const t of childrenByInitiative.get(initiative.id) ?? []) add(t)
  return { initiative, tasks }
}

/** Index tasks by the initiatives they declare `child_of`. */
function childrenIndex(tasksById: Map<string, Task>): Map<string, Task[]> {
  const out = new Map<string, Task[]>()
  for (const t of tasksById.values()) {
    for (const r of t.relations_out) {
      if (r.type !== "child_of") continue
      if (!out.has(r.target)) out.set(r.target, [])
      out.get(r.target)!.push(t)
    }
  }
  return out
}

/**
 * Task id → the initiative it belongs to. Reads both edge directions
 * (task child_of initiative, initiative parent_of task); the first initiative
 * found wins when a task hangs under several.
 */
export function taskInitiatives(): Map<string, { id: string; title: string }> {
  const entries = readManifest()
  const initiatives = new Map(
    entries
      .filter((e): e is Initiative => e.type === "initiative")
      .map((i) => [i.id, i] as const)
  )
  const out = new Map<string, { id: string; title: string }>()
  for (const e of entries) {
    if (e.type !== "task") continue
    const edge = e.relations_out.find(
      (r) => r.type === "child_of" && initiatives.has(r.target)
    )
    const init = edge && initiatives.get(edge.target)
    if (init) out.set(e.id, { id: init.id, title: init.title })
  }
  for (const init of initiatives.values()) {
    for (const r of init.relations_out) {
      if (r.type === "parent_of" && !out.has(r.target)) {
        out.set(r.target, { id: init.id, title: init.title })
      }
    }
  }
  return out
}

export function goalRollups(): GoalRollup[] {
  const entries = readManifest()
  const goals = entries.filter((e): e is Goal => e.type === "goal")
  const initiatives = entries.filter(
    (e): e is Initiative => e.type === "initiative"
  )
  const tasksById = new Map<string, Task>()
  for (const e of entries) {
    if (e.type === "task") tasksById.set(e.id, e as Task)
  }
  const children = childrenIndex(tasksById)

  return goals.map((goal) => {
    const contributing = initiatives.filter((initiative) =>
      initiative.relations_out.some(
        (r) => r.type === "contributes_to" && r.target === goal.id
      )
    )
    const rollups: InitiativeRollup[] = contributing.map((initiative) =>
      rollupInitiative(initiative, tasksById, children)
    )
    return { goal, detail: readGoalDetail(goal), initiatives: rollups }
  })
}

/**
 * Roadmap/timeline data: the full goal rollups plus a "No goal" bucket of
 * initiatives that contribute to no goal at all. Reads the manifest once for
 * the no-goal bucket; `goalRollups()` performs its own (separate) read.
 */
export type RoadmapData = {
  goals: GoalRollup[]
  noGoal: InitiativeRollup[]
}

export function roadmapData(): RoadmapData {
  const entries = readManifest()
  const goalIds = new Set(
    entries.filter((e) => e.type === "goal").map((e) => e.id)
  )
  const initiatives = entries.filter(
    (e): e is Initiative => e.type === "initiative"
  )
  const tasksById = new Map<string, Task>()
  for (const e of entries) {
    if (e.type === "task") tasksById.set(e.id, e as Task)
  }
  const children = childrenIndex(tasksById)

  // "No goal" = contributes to no EXISTING goal. Bucketing on the mere presence
  // of a contributes_to relation would drop an initiative whose target points at
  // a deleted/nonexistent goal (goalRollups() wouldn't surface it either) — so
  // resolve the target against the real goal ids to keep every initiative visible.
  const noGoal: InitiativeRollup[] = initiatives
    .filter(
      (initiative) =>
        !initiative.relations_out.some(
          (r) => r.type === "contributes_to" && goalIds.has(r.target)
        )
    )
    .map((initiative) => rollupInitiative(initiative, tasksById, children))

  return { goals: goalRollups(), noGoal }
}
