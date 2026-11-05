import type { SerializedTask } from "./types.js"

export const OPEN_TASK_STATUSES = new Set<string>([
  "plan",
  "ready",
  "doing",
  "blocked",
])

export const TASK_PRESETS = [
  { value: "open", label: "Open" },
  { value: "all", label: "All" },
  { value: "mine", label: "Mine" },
  { value: "current_iteration", label: "Current iteration" },
  { value: "overdue", label: "Overdue" },
  { value: "due_soon", label: "Due soon" },
  { value: "no_due_date", label: "No due date" },
  { value: "no_priority", label: "No priority" },
  { value: "unassigned_iteration", label: "Unassigned iteration" },
] as const

export type TaskPresetValue = (typeof TASK_PRESETS)[number]["value"]
export type TaskDueState = "overdue" | "due_soon" | "dated" | "none"

export type TaskPresetContext = {
  currentMember: string | null | undefined
  currentIteration: string | null | undefined
  today: string
}

type TaskRelation = {
  type: string
  target: string
}

type TaskWithRelations = SerializedTask & {
  relations_out?: readonly TaskRelation[]
}

const DEFAULT_PRESET: TaskPresetValue = "open"
const TASK_PRESET_VALUES = new Set<string>(
  TASK_PRESETS.map((preset) => preset.value)
)

export function normalizeTaskPreset(
  value: string | null | undefined
): TaskPresetValue {
  if (!value) return DEFAULT_PRESET
  return TASK_PRESET_VALUES.has(value)
    ? (value as TaskPresetValue)
    : DEFAULT_PRESET
}

function defaultToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  const utc = Date.UTC(year, month - 1, day + days)
  return new Date(utc).toISOString().slice(0, 10)
}

function isOpenTask(task: SerializedTask): boolean {
  return task.status !== null && OPEN_TASK_STATUSES.has(task.status)
}

export function getTaskDueState(
  task: SerializedTask,
  today = defaultToday()
): TaskDueState {
  if (!task.due_date) return "none"
  if (task.due_date < today) return "overdue"
  if (task.due_date <= addDays(today, 7)) return "due_soon"
  return "dated"
}

export function matchesTaskPreset(
  task: SerializedTask,
  preset: string | null | undefined,
  context: TaskPresetContext
): boolean {
  const normalizedPreset = normalizeTaskPreset(preset)
  const isOpen = isOpenTask(task)

  if (normalizedPreset === "all") return true
  if (!isOpen) return false

  if (normalizedPreset === "open") return true
  if (normalizedPreset === "mine") return task.owner === context.currentMember
  if (normalizedPreset === "current_iteration") {
    return task.iteration === context.currentIteration
  }
  if (normalizedPreset === "overdue") {
    return getTaskDueState(task, context.today) === "overdue"
  }
  if (normalizedPreset === "due_soon") {
    return getTaskDueState(task, context.today) === "due_soon"
  }
  if (normalizedPreset === "no_due_date") return !task.due_date
  if (normalizedPreset === "no_priority") return !task.priority
  if (normalizedPreset === "unassigned_iteration") return !task.iteration

  return false
}

export function getTaskRelationSignals(task: TaskWithRelations): {
  blockers: string[]
  blockedBy: string[]
  hasBlockers: boolean
  hasBlockedBy: boolean
} {
  const relations = task.relations_out ?? []
  const blockers = relations
    .filter((relation) => relation.type === "blocks")
    .map((relation) => relation.target)
  const blockedBy = relations
    .filter((relation) => relation.type === "blocked_by")
    .map((relation) => relation.target)

  return {
    blockers,
    blockedBy,
    hasBlockers: blockers.length > 0,
    hasBlockedBy: blockedBy.length > 0,
  }
}
