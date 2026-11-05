import type { ColorBy } from "./types"

// ─── Priority coloring (existing behavior, unchanged) ────────────────────────

export const PRIORITY_FILL: Record<string, string> = {
  do: "#f43f5e",
  plan: "#3b82f6",
  routine: "#71717a",
  drop: "#d4d4d8",
  none: "#a1a1aa",
}

export const PRIORITY_RING: Record<string, string> = {
  do: "#be123c",
  plan: "#1d4ed8",
  routine: "#52525b",
  drop: "#a1a1aa",
  none: "#71717a",
}

export const STATUS_RING: Record<string, string> = {
  doing: "#10b981",
  blocked: "#f59e0b",
}

export const STATUS_OPEN = new Set(["ready", "doing", "blocked"])

export const EDGE_TYPE_LABEL: Record<string, string> = {
  child_of: "child of",
  parent_of: "parent of",
  blocks: "blocks",
  blocked_by: "blocked by",
  depends_on: "depends on",
  related_to: "related to",
}

// ─── Categorical palette for color-by dimensions ─────────────────────────────
// 10 harmonious hues sampled at irregular Tailwind 500/600 intervals.
// Chosen to avoid pure-red/green clash and work cleanly on white canvas.

export const CATEGORICAL_PALETTE = [
  "#f43f5e", // rose-500
  "#f97316", // orange-500
  "#f59e0b", // amber-500
  "#84cc16", // lime-500 (but 600 below for better contrast on white)
  "#10b981", // emerald-500
  "#06b6d4", // cyan-500
  "#38bdf8", // sky-400
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#d946ef", // fuchsia-500
]

export const INITIATIVE_FILL = "#0f172a"
export const NULL_FILL = "#a1a1aa" // neutral-400 for missing values

/**
 * Stable hash: maps a string value → palette index.
 * Uses djb2 so same value always gets same color.
 */
export function stableColorIndex(value: string, paletteSize: number): number {
  let hash = 5381
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i)
    hash = hash >>> 0 // keep unsigned 32-bit
  }
  return hash % paletteSize
}

export function categoricalColor(value: string | null | undefined): string {
  if (!value) return NULL_FILL
  return CATEGORICAL_PALETTE[stableColorIndex(value, CATEGORICAL_PALETTE.length)]
}

/** Get the fill color for a node given the active colorBy dimension */
export function nodeColor(
  colorBy: ColorBy,
  priority: string,
  owner: string | null,
  area: string | null,
  iteration: string | null
): string {
  switch (colorBy) {
    case "priority":
      return PRIORITY_FILL[priority] ?? NULL_FILL
    case "owner":
      return categoricalColor(owner)
    case "area":
      return categoricalColor(area)
    case "iteration":
      return categoricalColor(iteration)
  }
}

/** Get the ring/border color for a node given the active colorBy dimension */
export function nodeRingColor(
  colorBy: ColorBy,
  priority: string,
  owner: string | null,
  area: string | null,
  iteration: string | null,
  status: string
): string {
  // Status ring always wins over colorBy ring
  if (STATUS_RING[status]) return STATUS_RING[status]
  switch (colorBy) {
    case "priority":
      return PRIORITY_RING[priority] ?? "#71717a"
    case "owner":
      return categoricalColor(owner)
    case "area":
      return categoricalColor(area)
    case "iteration":
      return categoricalColor(iteration)
  }
}

// ─── localStorage / URL keys ──────────────────────────────────────────────────

export const LS_KEYS = {
  showDone: "taskgraph.showDone.v1",
  showOrphans: "taskgraph.showOrphans.v1",
  depth: "taskgraph.depth.v1",
  colorBy: "taskgraph.colorBy.v1",
  filters: "taskgraph.filters.v1",
} as const

export const COLOR_BY_OPTIONS: { value: ColorBy; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "owner", label: "Owner" },
  { value: "area", label: "Area" },
  { value: "iteration", label: "Iteration" },
]
