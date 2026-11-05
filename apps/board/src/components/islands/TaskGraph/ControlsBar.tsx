import { useState } from "react"
import type { ColorBy, FilterState, GraphNode } from "./types"
import {
  PRIORITY_FILL,
  CATEGORICAL_PALETTE,
  NULL_FILL,
  INITIATIVE_FILL,
  COLOR_BY_OPTIONS,
  stableColorIndex,
} from "./constants"

// ─── Legend helpers ───────────────────────────────────────────────────────────

function LegendDot({
  shape,
  fill,
  label,
}: {
  shape: "circle" | "square"
  fill: string
  label: string
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span
        className={`inline-block h-2.5 w-2.5 flex-none ${shape === "circle" ? "rounded-full" : "rounded-[3px]"}`}
        style={{ backgroundColor: fill }}
      />
      <span className="truncate max-w-[80px]">{label}</span>
    </span>
  )
}

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span
        className="inline-block h-2.5 w-2.5 flex-none rounded-full border-2"
        style={{ borderColor: color }}
      />
      {label}
    </span>
  )
}

// ─── FilterPill ───────────────────────────────────────────────────────────────

function FilterPill({
  label,
  count,
  active,
  onToggle,
}: {
  label: string
  count: number
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex h-6 items-center gap-0.5 rounded-full border px-2 text-[11px] transition-colors ${
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground hover:border-border"
      }`}
    >
      {label}
      <span
        className={`ml-1 ${active ? "text-muted-foreground/60" : "text-muted-foreground"}`}
      >
        {count}
      </span>
    </button>
  )
}

// ─── PillGroup ────────────────────────────────────────────────────────────────

function PillGroup({
  title,
  values,
  active,
  counts,
  onToggle,
}: {
  title: string
  values: string[]
  active: string[]
  counts: Map<string, number>
  onToggle: (v: string) => void
}) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mr-0.5">
        {title}
      </span>
      {values.map((v) => (
        <FilterPill
          key={v}
          label={v}
          count={counts.get(v) ?? 0}
          active={active.includes(v)}
          onToggle={() => onToggle(v)}
        />
      ))}
    </div>
  )
}

// ─── Legend for current colorBy ───────────────────────────────────────────────

function ColorByLegend({
  colorBy,
  nodes,
}: {
  colorBy: ColorBy
  nodes: GraphNode[]
}) {
  const MAX_VISIBLE = 8
  const [tooltipOpen, setTooltipOpen] = useState(false)

  if (colorBy === "priority") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <LegendDot shape="square" fill={INITIATIVE_FILL} label="initiative" />
        <LegendDot shape="circle" fill={PRIORITY_FILL.do} label="do" />
        <LegendDot shape="circle" fill={PRIORITY_FILL.plan} label="plan" />
        <LegendDot shape="circle" fill={PRIORITY_FILL.routine} label="routine" />
        <LegendDot shape="circle" fill={PRIORITY_FILL.drop} label="drop" />
        <StatusDot color="#10b981" label="in progress" />
        <StatusDot color="#f59e0b" label="blocked" />
      </div>
    )
  }

  // Collect distinct values for the active dimension
  const valueSet = new Set<string>()
  for (const n of nodes) {
    if (n.type === "initiative") continue
    const v =
      colorBy === "owner"
        ? n.owner
        : colorBy === "area"
          ? n.area
          : n.iteration
    if (v) valueSet.add(v)
  }
  const values = Array.from(valueSet).sort()
  const visible = values.slice(0, MAX_VISIBLE)
  const overflow = values.slice(MAX_VISIBLE)

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <LegendDot shape="square" fill={INITIATIVE_FILL} label="initiative" />
      <LegendDot shape="circle" fill={NULL_FILL} label="(none)" />
      {visible.map((v) => (
        <LegendDot
          key={v}
          shape="circle"
          fill={CATEGORICAL_PALETTE[stableColorIndex(v, CATEGORICAL_PALETTE.length)]}
          label={v}
        />
      ))}
      {overflow.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onMouseEnter={() => setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-muted-foreground underline decoration-dotted"
          >
            +{overflow.length} more
          </button>
          {tooltipOpen && (
            <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[120px] rounded-md border border-border bg-card p-2 shadow-md text-[11px] text-foreground">
              {overflow.map((v) => (
                <div key={v} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className="inline-block h-2 w-2 flex-none rounded-full"
                    style={{
                      backgroundColor:
                        CATEGORICAL_PALETTE[stableColorIndex(v, CATEGORICAL_PALETTE.length)],
                    }}
                  />
                  {v}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ControlsBar ─────────────────────────────────────────────────────────────

export function ControlsBar({
  // search
  searchQuery,
  onSearchChange,
  searchInputRef,
  // depth
  depth,
  onDepthChange,
  // color-by
  colorBy,
  onColorByChange,
  // filters disclosure
  filters,
  onFiltersChange,
  allOwners,
  allAreas,
  allIterations,
  ownerCounts,
  areaCounts,
  iterationCounts,
  // checkboxes (moved into row 2)
  showDone,
  onShowDoneChange,
  showOrphans,
  onShowOrhansChange,
  // stats + actions
  nodeCount,
  edgeCount,
  hasSelection,
  onClear,
  onFit,
  // for legend
  nodes,
}: {
  searchQuery: string
  onSearchChange: (v: string) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
  depth: number
  onDepthChange: (v: number) => void
  colorBy: ColorBy
  onColorByChange: (v: ColorBy) => void
  filters: FilterState
  onFiltersChange: (f: FilterState) => void
  allOwners: string[]
  allAreas: string[]
  allIterations: string[]
  ownerCounts: Map<string, number>
  areaCounts: Map<string, number>
  iterationCounts: Map<string, number>
  showDone: boolean
  onShowDoneChange: (v: boolean) => void
  showOrphans: boolean
  onShowOrhansChange: (v: boolean) => void
  nodeCount: number
  edgeCount: number
  hasSelection: boolean
  onClear: () => void
  onFit: () => void
  nodes: GraphNode[]
}) {
  const [filtersOpen, setFiltersOpen] = useState(false)

  const activeFilterCount =
    filters.owners.length + filters.areas.length + filters.iterations.length

  function toggleOwner(v: string) {
    onFiltersChange({
      ...filters,
      owners: filters.owners.includes(v)
        ? filters.owners.filter((x) => x !== v)
        : [...filters.owners, v],
    })
  }
  function toggleArea(v: string) {
    onFiltersChange({
      ...filters,
      areas: filters.areas.includes(v)
        ? filters.areas.filter((x) => x !== v)
        : [...filters.areas, v],
    })
  }
  function toggleIteration(v: string) {
    onFiltersChange({
      ...filters,
      iterations: filters.iterations.includes(v)
        ? filters.iterations.filter((x) => x !== v)
        : [...filters.iterations, v],
    })
  }

  const hasFilters = filtersOpen || activeFilterCount > 0

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur overflow-hidden">
      {/* ── Row 1: primary controls ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2 text-xs">
        {/* Search */}
        <div className="relative">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search nodes…  ( / )"
            className="h-7 w-52 rounded-md border border-border bg-background px-2 pr-7 text-xs text-foreground placeholder-neutral-400 outline-none focus:border-border focus:bg-card"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>

        <div className="h-5 w-px bg-muted mx-1" aria-hidden />

        {/* Depth */}
        <div className="flex items-center gap-2 text-foreground">
          <label htmlFor="depth-slider" className="whitespace-nowrap">
            Depth <span className="font-mono font-semibold">{depth}</span>
          </label>
          <input
            id="depth-slider"
            type="range"
            min={1}
            max={4}
            value={depth}
            onChange={(e) => onDepthChange(Number(e.target.value))}
            className="h-1 w-20 cursor-pointer accent-neutral-900"
          />
        </div>

        <div className="h-5 w-px bg-muted mx-1" aria-hidden />

        {/* Color-by */}
        <div className="flex items-center gap-1.5 text-foreground">
          <span className="whitespace-nowrap">Color by</span>
          <select
            value={colorBy}
            onChange={(e) => onColorByChange(e.target.value as ColorBy)}
            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-border cursor-pointer"
          >
            {COLOR_BY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="h-5 w-px bg-muted mx-1" aria-hidden />

        {/* Filters disclosure */}
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors ${
            activeFilterCount > 0 || filtersOpen
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-background text-foreground hover:border-border"
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                activeFilterCount > 0
                  ? "bg-card/20 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {activeFilterCount}
            </span>
          )}
          <svg
            className={`h-3 w-3 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Spacer */}
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[11px] tracking-tight text-muted-foreground">
            {nodeCount} nodes · {edgeCount} edges
          </span>
          {hasSelection && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onFit}
            className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-border hover:text-foreground"
          >
            Fit view
          </button>
        </div>
      </div>

      {/* ── Row 2: filters panel (collapsible) ──────────────────────────────── */}
      {hasFilters && (
        <div className="border-t border-border px-3 py-2.5 flex flex-col gap-2.5">
          {/* Checkboxes */}
          <div className="flex items-center gap-4 text-xs text-foreground">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showDone}
                onChange={(e) => onShowDoneChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900"
              />
              Include done / archived
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => onShowOrhansChange(e.target.checked)}
                className="h-3.5 w-3.5 accent-neutral-900"
              />
              Show orphan tasks
            </label>
          </div>

          {/* Pills */}
          <PillGroup
            title="Owner"
            values={allOwners}
            active={filters.owners}
            counts={ownerCounts}
            onToggle={toggleOwner}
          />
          <PillGroup
            title="Area"
            values={allAreas}
            active={filters.areas}
            counts={areaCounts}
            onToggle={toggleArea}
          />
          <PillGroup
            title="Iteration"
            values={allIterations}
            active={filters.iterations}
            counts={iterationCounts}
            onToggle={toggleIteration}
          />
        </div>
      )}

      {/* ── Row 3: legend (always visible, compact) ─────────────────────────── */}
      <div className="border-t border-border px-3 py-1.5 text-[11px]">
        <ColorByLegend colorBy={colorBy} nodes={nodes} />
      </div>
    </div>
  )
}
