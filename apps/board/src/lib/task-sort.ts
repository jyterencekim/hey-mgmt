import type { SerializedTask } from "./types.js"

export const PRIORITY_ORDER: Record<string, number> = {
  do: 0,
  plan: 1,
  routine: 2,
  drop: 3,
}

const STATUS_ORDER: Record<string, number> = {
  plan: 0,
  ready: 1,
  active: 1,
  doing: 2,
  in_progress: 2,
  blocked: 3,
  done: 4,
  archived: 5,
  cancelled: 6,
}

export const TASK_SORT_OPTIONS = [
  { value: "due_asc", label: "Due earliest" },
  { value: "due_desc", label: "Due latest" },
  { value: "priority_asc", label: "Priority high to low" },
  { value: "priority_desc", label: "Priority low to high" },
  { value: "status_asc", label: "Status workflow" },
  { value: "status_desc", label: "Status reverse" },
  { value: "owner_asc", label: "Owner A-Z" },
  { value: "owner_desc", label: "Owner Z-A" },
  { value: "iteration_desc", label: "Iteration latest" },
  { value: "iteration_asc", label: "Iteration oldest" },
  { value: "title_asc", label: "Title A-Z" },
  { value: "title_desc", label: "Title Z-A" },
  { value: "updated_desc", label: "Updated newest" },
  { value: "updated_asc", label: "Updated oldest" },
] as const

export type TaskSortValue = (typeof TASK_SORT_OPTIONS)[number]["value"]

// Tasks read best highest-priority first (do → plan → routine → drop).
export const DEFAULT_TASK_SORT: TaskSortValue = "priority_asc"
const SORT_VALUES = new Set<string>(
  TASK_SORT_OPTIONS.map((option) => option.value)
)
const SORT_ALIASES: Record<string, TaskSortValue> = {
  priority: "priority_asc",
}

export function normalizeTaskSort(
  value: string | null | undefined
): TaskSortValue {
  if (!value) return DEFAULT_TASK_SORT
  if (SORT_ALIASES[value]) return SORT_ALIASES[value]
  return SORT_VALUES.has(value) ? (value as TaskSortValue) : DEFAULT_TASK_SORT
}

function compareNullableString(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: "asc" | "desc"
): number {
  if (a && b) {
    const result = a.localeCompare(b)
    return direction === "asc" ? result : -result
  }
  if (a) return -1
  if (b) return 1
  return 0
}

function compareRank(
  a: string | null | undefined,
  b: string | null | undefined,
  order: Record<string, number>,
  direction: "asc" | "desc"
): number {
  const ra = a ? (order[a] ?? 99) : null
  const rb = b ? (order[b] ?? 99) : null

  if (ra !== null && rb !== null) {
    return direction === "asc" ? ra - rb : rb - ra
  }
  if (ra !== null) return -1
  if (rb !== null) return 1
  return 0
}

function titleSort(a: SerializedTask, b: SerializedTask): number {
  return compareNullableString(a.title, b.title, "asc")
}

export function compareTasksBySort(
  a: SerializedTask,
  b: SerializedTask,
  sort: string
): number {
  const normalizedSort = normalizeTaskSort(sort)

  if (normalizedSort === "due_desc") {
    return (
      compareNullableString(a.due_date, b.due_date, "desc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "priority_asc") {
    return (
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "priority_desc") {
    return (
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "desc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "status_asc") {
    return (
      compareRank(a.status, b.status, STATUS_ORDER, "asc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "status_desc") {
    return (
      compareRank(a.status, b.status, STATUS_ORDER, "desc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "owner_asc") {
    return (
      compareNullableString(a.owner, b.owner, "asc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "owner_desc") {
    return (
      compareNullableString(a.owner, b.owner, "desc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "iteration_desc") {
    return (
      compareNullableString(a.iteration, b.iteration, "desc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "iteration_asc") {
    return (
      compareNullableString(a.iteration, b.iteration, "asc") ||
      compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
      compareNullableString(a.due_date, b.due_date, "asc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "title_desc") {
    return compareNullableString(a.title, b.title, "desc")
  }

  if (normalizedSort === "title_asc") {
    return titleSort(a, b)
  }

  if (normalizedSort === "updated_desc") {
    return (
      compareNullableString(a.updated_at, b.updated_at, "desc") ||
      titleSort(a, b)
    )
  }

  if (normalizedSort === "updated_asc") {
    return (
      compareNullableString(a.updated_at, b.updated_at, "asc") ||
      titleSort(a, b)
    )
  }

  return (
    compareNullableString(a.due_date, b.due_date, "asc") ||
    compareRank(a.priority, b.priority, PRIORITY_ORDER, "asc") ||
    titleSort(a, b)
  )
}
