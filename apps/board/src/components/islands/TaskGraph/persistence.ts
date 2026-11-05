import { LS_KEYS } from "./constants"
import type { ColorBy, FilterState } from "./types"

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: FilterState = { owners: [], areas: [], iterations: [] }

// ─── localStorage helpers ─────────────────────────────────────────────────────

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}

function lsBool(key: string, fallback: boolean): boolean {
  const v = lsGet(key)
  if (v === null) return fallback
  return v === "1"
}

function lsNum(key: string, fallback: number, min: number, max: number): number {
  const v = lsGet(key)
  if (v === null) return fallback
  const n = parseInt(v, 10)
  if (isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function lsColorBy(fallback: ColorBy): ColorBy {
  const v = lsGet(LS_KEYS.colorBy)
  if (v === "priority" || v === "owner" || v === "area" || v === "iteration") return v
  return fallback
}

function lsFilters(): FilterState {
  const v = lsGet(LS_KEYS.filters)
  if (!v) return { ...DEFAULT_FILTERS }
  try {
    const parsed = JSON.parse(v) as unknown
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      const p = parsed as Record<string, unknown>
      return {
        owners: Array.isArray(p.owners) ? (p.owners as string[]) : [],
        areas: Array.isArray(p.areas) ? (p.areas as string[]) : [],
        iterations: Array.isArray(p.iterations) ? (p.iterations as string[]) : [],
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_FILTERS }
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function urlGet(key: string): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get(key)
}

function urlBool(key: string): boolean | null {
  const v = urlGet(key)
  if (v === null) return null
  return v === "1"
}

function urlNum(key: string, min: number, max: number): number | null {
  const v = urlGet(key)
  if (v === null) return null
  const n = parseInt(v, 10)
  if (isNaN(n)) return null
  return Math.max(min, Math.min(max, n))
}

function urlColorBy(): ColorBy | null {
  const v = urlGet("color")
  if (v === "priority" || v === "owner" || v === "area" || v === "iteration") return v
  return null
}

// ─── Initial state resolution (URL > localStorage > defaults) ─────────────────

export interface InitialState {
  showDone: boolean
  showOrphans: boolean
  depth: number
  colorBy: ColorBy
  filters: FilterState
  searchQuery: string
  selectedId: string | null
}

export function resolveInitialState(): InitialState {
  const lsFiltersVal = lsFilters()

  return {
    showDone: urlBool("done") ?? lsBool(LS_KEYS.showDone, false),
    showOrphans: urlBool("orphans") ?? lsBool(LS_KEYS.showOrphans, false),
    depth: urlNum("depth", 1, 4) ?? lsNum(LS_KEYS.depth, 2, 1, 4),
    colorBy: urlColorBy() ?? lsColorBy("priority"),
    filters: lsFiltersVal,
    // search + focus: URL only (ephemeral)
    searchQuery: urlGet("q") ?? "",
    selectedId: urlGet("focus") ?? null,
  }
}

// ─── Persist to localStorage ──────────────────────────────────────────────────

export function persistState(
  showDone: boolean,
  showOrphans: boolean,
  depth: number,
  colorBy: ColorBy,
  filters: FilterState
): void {
  lsSet(LS_KEYS.showDone, showDone ? "1" : "0")
  lsSet(LS_KEYS.showOrphans, showOrphans ? "1" : "0")
  lsSet(LS_KEYS.depth, String(depth))
  lsSet(LS_KEYS.colorBy, colorBy)
  lsSet(LS_KEYS.filters, JSON.stringify(filters))
}

// ─── Sync to URL via replaceState ─────────────────────────────────────────────

export function syncToUrl(
  showDone: boolean,
  showOrphans: boolean,
  searchQuery: string,
  depth: number,
  selectedId: string | null,
  colorBy: ColorBy
): void {
  const params = new URLSearchParams()
  if (showDone) params.set("done", "1")
  if (showOrphans) params.set("orphans", "1")
  if (searchQuery) params.set("q", searchQuery)
  if (depth !== 2) params.set("depth", String(depth))
  if (selectedId) params.set("focus", selectedId)
  if (colorBy !== "priority") params.set("color", colorBy)

  const search = params.toString()
  const newUrl = window.location.pathname + (search ? `?${search}` : "")
  history.replaceState(null, "", newUrl)
}
