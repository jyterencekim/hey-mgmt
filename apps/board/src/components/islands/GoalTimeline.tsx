import { useCallback, useEffect, useRef, useState } from "react"
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react"
import { formatDisplayDate } from "@/lib/date-format"

// ---------------------------------------------------------------------------
// Serialized prop shapes. The island is client:only, so the page passes plain
// JSON — no manifest types cross the boundary. Hrefs are built here from ids
// (see artifactHref / taskHref) to keep the prop payload small.
// ---------------------------------------------------------------------------

export interface TimelineTask {
  id: string
  title: string
  status: string | null
  priority: "do" | "plan" | "routine" | "drop" | null
  owner: string | null
  due_date: string | null
  // Product-task schedule (decision_adr-product-initiative-kickoff D3).
  // Optional so older payloads still render.
  component?: string | null
  start_date?: string | null
  target_date?: string | null
  created_at?: string | null
}

export interface TimelineInitiative {
  id: string
  title: string
  status: string | null
  priority?: TimelineTask["priority"]
  owner: string | null
  timeline_start: string | null
  timeline_end: string | null
  // Kickoff contract (decision_adr-product-initiative-kickoff D1/D2).
  initiative_kind?: "product" | "business" | "marketing" | "ops" | null
  prd_doc?: string | null
  components?: string[]
  kickoff_date?: string | null
  baseline_tasks?: string[]
  tasks: TimelineTask[]
}

export interface TimelineGoal {
  id: string
  title: string
  status: string | null
  target_date: string | null
  metric: string | null
  target: string | null
  current: string | null
  // Set on the kind lanes the Roadmap view builds (no goal artifact behind it).
  synthetic?: boolean
}

export interface TimelineGoalGroup {
  goal: TimelineGoal
  initiatives: TimelineInitiative[]
}

export interface RoadmapProp {
  goals: TimelineGoalGroup[]
  noGoal: TimelineInitiative[]
}

interface Props {
  data: RoadmapProp
  today: string // "YYYY-MM-DD"
  language: string
  // "goal" = Goals page (initiatives under the goal they contribute to);
  // "kind" = Roadmap page (each initiative once, in a lane per initiative kind).
  groupBy?: "goal" | "kind"
  // Roadmap page: show one Eisenhower quadrant at a time (?priority=).
  priorityTabs?: boolean
}

// ---------------------------------------------------------------------------
// Colour tokens — mirrored from the existing badges so the timeline reads as
// one system with the table view. StatusBadge palette drives initiative /
// task colours; GOAL_STATUS mirrors goals/index.astro.
// ---------------------------------------------------------------------------

// Initiative status → bar/point fill + border. Kept as concrete Tailwind
// utility strings (not interpolated) so the JIT compiler sees them.
const INITIATIVE_BAR: Record<string, string> = {
  active: "bg-emerald-500 border-emerald-600",
  in_progress: "bg-sky-500 border-sky-600",
  plan: "bg-violet-500 border-violet-600",
  blocked: "bg-red-500 border-red-600",
  done: "bg-muted-foreground/50 border-muted-foreground/60",
}
function initiativeBarClass(status: string | null): string {
  return (status && INITIATIVE_BAR[status]) || "bg-muted-foreground/40 border-muted-foreground/50"
}

const INITIATIVE_BADGE: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  in_progress: "bg-sky-100 text-sky-800",
  plan: "bg-violet-100 text-violet-800",
  blocked: "bg-red-100 text-red-800",
  done: "bg-muted text-muted-foreground",
  archived: "bg-background text-muted-foreground",
  cancelled: "bg-background text-muted-foreground line-through",
}
const INITIATIVE_LABEL: Record<string, string> = {
  plan: "Planned",
  active: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
  cancelled: "Cancelled",
}
function statusBadge(status: string | null) {
  const cls =
    (status && INITIATIVE_BADGE[status]) || "bg-muted text-muted-foreground"
  const label = status ? (INITIATIVE_LABEL[status] ?? status) : "—"
  return { cls, label }
}

// Priority vocab (do | plan | routine | drop) — mirror of PriorityBadge.astro
// so the expanded task table reads as the same system as the Table view.
const PRIORITY_BADGE: Record<string, string> = {
  do: "bg-red-100 text-red-800",
  plan: "bg-blue-100 text-blue-800",
  routine: "bg-amber-100 text-amber-800",
  drop: "bg-muted text-muted-foreground",
}
function priorityBadge(priority: string | null) {
  const cls =
    (priority && PRIORITY_BADGE[priority]) || "bg-background text-muted-foreground"
  const label = priority ?? "—"
  return { cls, label }
}

// Goal status vocab (active | hit | missed | archived) — mirror of
// GOAL_STATUS_CLASS in goals/index.astro.
const GOAL_STATUS: Record<string, string> = {
  active: "bg-sky-100 text-sky-800",
  hit: "bg-emerald-100 text-emerald-800",
  missed: "bg-red-100 text-red-800",
  archived: "bg-background text-muted-foreground",
}
function goalStatusClass(status: string | null): string {
  return status
    ? (GOAL_STATUS[status] ?? "bg-muted text-muted-foreground")
    : "bg-background text-muted-foreground"
}

// ---------------------------------------------------------------------------
// Date maths. All positioning is a percentage of the domain [min, max].
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

function parseDay(value: string | null | undefined): number | null {
  if (!value) return null
  const t = Date.parse(value.length <= 10 ? `${value}T00:00:00Z` : value)
  return Number.isNaN(t) ? null : t
}

function addDays(ms: number, days: number): number {
  return ms + days * DAY_MS
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Start of the calendar quarter containing `ms` (UTC). */
function quarterStart(ms: number): number {
  const d = new Date(ms)
  const q = Math.floor(d.getUTCMonth() / 3) * 3
  return Date.UTC(d.getUTCFullYear(), q, 1)
}
/** First day of the quarter AFTER the one containing `ms` (UTC). */
function quarterEnd(ms: number): number {
  const d = new Date(ms)
  const q = Math.floor(d.getUTCMonth() / 3) * 3
  return Date.UTC(d.getUTCFullYear(), q + 3, 1)
}

function artifactHref(id: string): string {
  return `/artifacts/${id}/`
}
function taskHref(id: string): string {
  return `/tasks/${id}/`
}

// Derived hint for an unscheduled initiative: max child-task due date.
function maxTaskDue(tasks: TimelineTask[]): string | null {
  let best: number | null = null
  for (const t of tasks) {
    const d = parseDay(t.due_date)
    if (d !== null && (best === null || d > best)) best = d
  }
  return best === null ? null : isoDay(best)
}

// ---------------------------------------------------------------------------
// Domain + axis computation
// ---------------------------------------------------------------------------

interface Domain {
  min: number
  max: number
  days: number
  pxPerDay: number
  width: number
}

function computeDomain(data: RoadmapProp, todayMs: number, pxPerDay: number): Domain {
  const starts: number[] = []
  const ends: number[] = []

  const collect = (init: TimelineInitiative) => {
    const s = parseDay(init.timeline_start)
    const e = parseDay(init.timeline_end)
    if (s !== null) starts.push(s)
    if (e !== null) ends.push(e)
    for (const t of init.tasks) {
      const ts = parseDay(t.start_date)
      const te = parseDay(t.target_date)
      if (ts !== null) starts.push(ts)
      if (te !== null) ends.push(te)
    }
  }
  for (const g of data.goals) {
    g.initiatives.forEach(collect)
    const gd = parseDay(g.goal.target_date)
    if (gd !== null) ends.push(gd)
  }
  data.noGoal.forEach(collect)

  // min = min(today-28d, earliest start). max = max(all ends, today) + 14d.
  let min = addDays(todayMs, -28)
  for (const s of starts) if (s < min) min = s

  let max = addDays(todayMs, 14)
  for (const e of ends) {
    const padded = addDays(e, 14)
    if (padded > max) max = padded
  }

  // Guarantee the domain spans at least the current calendar quarter, then
  // snap the visible edges to quarter boundaries for tidy month columns.
  const qStart = quarterStart(todayMs)
  const qEnd = quarterEnd(todayMs)
  if (qStart < min) min = qStart
  if (qEnd > max) max = qEnd
  min = quarterStart(min)
  max = quarterEnd(max)

  const days = Math.max(1, Math.round((max - min) / DAY_MS))
  const width = days * pxPerDay
  return { min, max, days, pxPerDay, width }
}

/** Left position (%) of a date within the domain; clamped to [0,100]. */
function leftPct(ms: number, d: Domain): number {
  const pct = ((ms - d.min) / (d.max - d.min)) * 100
  return Math.min(100, Math.max(0, pct))
}

interface MonthTick {
  label: string
  leftPct: number
}
interface WeekTick {
  leftPct: number
}

function buildTicks(d: Domain, language: string): { months: MonthTick[]; weeks: WeekTick[] } {
  const months: MonthTick[] = []
  const monthFmt = new Intl.DateTimeFormat(
    language === "ko" ? "ko-KR" : "en-US",
    { month: "short", year: "numeric", timeZone: "UTC" }
  )
  // Month ticks
  const start = new Date(d.min)
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth()
  for (;;) {
    const ms = Date.UTC(y, m, 1)
    if (ms > d.max) break
    if (ms >= d.min) {
      months.push({ label: monthFmt.format(new Date(ms)), leftPct: leftPct(ms, d) })
    }
    m += 1
    if (m > 11) {
      m = 0
      y += 1
    }
  }

  // Week gridlines — Mondays across the domain.
  const weeks: WeekTick[] = []
  const first = new Date(d.min)
  const dow = first.getUTCDay() // 0=Sun
  const offsetToMonday = (8 - dow) % 7
  let wk = addDays(d.min, offsetToMonday)
  while (wk <= d.max) {
    weeks.push({ leftPct: leftPct(wk, d) })
    wk = addDays(wk, 7)
  }
  return { months, weeks }
}

// ---------------------------------------------------------------------------
// Task-dot due state
// ---------------------------------------------------------------------------

type DueState = "overdue" | "soon" | "done" | "neutral"

function taskDueState(task: TimelineTask, todayMs: number): DueState {
  if (task.status === "done") return "done"
  const due = parseDay(task.due_date)
  if (due === null) return "neutral"
  if (due < todayMs) return "overdue"
  if (due <= addDays(todayMs, 7)) return "soon"
  return "neutral"
}

// ---------------------------------------------------------------------------
// Product-initiative kickoff contract (decision_adr-product-initiative-kickoff)
// D2 fields, D3 component-level dated tasks, D5 scope diff, D6 gap flags.
// ---------------------------------------------------------------------------

const OPEN_TASK_STATUSES = new Set(["plan", "ready", "doing", "blocked"])
const CLOSED_TASK_STATUSES = new Set(["done", "archived", "cancelled"])
const NO_COMPONENT = "(no component)"
const MAX_TOOLTIP_LINES = 10

function isProduct(init: TimelineInitiative): boolean {
  return init.initiative_kind === "product"
}

/** D3: an open task whose planned finish (x_target_date) has passed. */
function taskSlipped(task: TimelineTask, todayMs: number): boolean {
  const target = parseDay(task.target_date)
  return (
    target !== null &&
    target < todayMs &&
    OPEN_TASK_STATUSES.has(task.status ?? "")
  )
}

/** D6 gap list for a product initiative (empty for every other kind). */
function productGaps(init: TimelineInitiative, todayMs: number): string[] {
  if (!isProduct(init)) return []
  const gaps: string[] = []
  const components = init.components ?? []
  if (!init.timeline_start) gaps.push("missing x_timeline_start")
  if (!init.timeline_end) gaps.push("missing x_timeline_end")
  if (!init.prd_doc) gaps.push("missing x_prd_doc")
  if (components.length === 0) gaps.push("missing x_components")
  if (!init.kickoff_date) gaps.push("missing x_kickoff_date")
  if ((init.baseline_tasks ?? []).length === 0)
    gaps.push("missing x_baseline_tasks")

  const known = new Set(components)
  for (const t of init.tasks) {
    if (!OPEN_TASK_STATUSES.has(t.status ?? "")) continue
    const missing: string[] = []
    if (!t.component) missing.push("x_component")
    if (!t.start_date) missing.push("x_start_date")
    if (!t.target_date) missing.push("x_target_date")
    if (missing.length > 0) gaps.push(`${t.title}: missing ${missing.join(", ")}`)
    if (t.component && known.size > 0 && !known.has(t.component))
      gaps.push(`${t.title}: x_component "${t.component}" not in x_components`)
    if (taskSlipped(t, todayMs))
      gaps.push(`${t.title}: x_target_date ${t.target_date} passed`)
  }
  return gaps
}

interface ScopeChange {
  kickoff: string
  /** Linked task ids not in x_baseline_tasks, minus tasks dropped before kickoff. */
  added: Set<string>
  /** Baseline ids no longer linked, or linked but archived/cancelled. */
  removed: string[]
}

/** D5 diff against x_baseline_tasks; null until the initiative is kicked off. */
function scopeChange(init: TimelineInitiative): ScopeChange | null {
  const baseline = init.baseline_tasks ?? []
  if (!isProduct(init) || !init.kickoff_date || baseline.length === 0)
    return null
  const base = new Set(baseline)
  const byId = new Map(init.tasks.map((t) => [t.id, t]))
  const kickoff = init.kickoff_date
  const added = new Set(
    init.tasks
      .filter((t) => !base.has(t.id))
      .filter(
        (t) =>
          !CLOSED_TASK_STATUSES.has(t.status ?? "") ||
          t.status === "done" ||
          (t.created_at ?? "").slice(0, 10) > kickoff
      )
      .map((t) => t.id)
  )
  const removed = baseline.filter((id) => {
    const t = byId.get(id)
    return !t || (t.status !== "done" && CLOSED_TASK_STATUSES.has(t.status ?? ""))
  })
  return { kickoff: init.kickoff_date, added, removed }
}

/** Product tasks grouped by x_component, in x_components order; rest last. */
function groupByComponent(
  init: TimelineInitiative
): { label: string; tasks: TimelineTask[] }[] {
  const components = [...new Set(init.components ?? [])]
  const byComponent = new Map<string, TimelineTask[]>(
    components.map((c) => [c, []])
  )
  const rest: TimelineTask[] = []
  for (const t of init.tasks) {
    const bucket = t.component ? byComponent.get(t.component) : undefined
    if (bucket) bucket.push(t)
    else rest.push(t)
  }
  // Within a component, order by planned start (then target) so bars read
  // left-to-right; undated tasks sink to the bottom of their group.
  const key = (t: TimelineTask) =>
    parseDay(t.start_date) ?? parseDay(t.target_date) ?? Number.POSITIVE_INFINITY
  const sorted = (ts: TimelineTask[]) => [...ts].sort((a, b) => key(a) - key(b))
  const groups = components.map((c) => ({
    label: c,
    tasks: sorted(byComponent.get(c)!),
  }))
  if (rest.length > 0) groups.push({ label: NO_COMPONENT, tasks: sorted(rest) })
  return groups
}

function tooltipLines(lines: string[]): string {
  const shown = lines.slice(0, MAX_TOOLTIP_LINES).map((l) => `• ${l}`)
  if (lines.length > MAX_TOOLTIP_LINES)
    shown.push(`…and ${lines.length - MAX_TOOLTIP_LINES} more`)
  return shown.join("\n")
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

// Sticky left column width. The default is 1.5× the original 264px baseline;
// the user can drag the handle to resize (persisted to localStorage). The
// live value flows to every sticky cell via the `--gt-label-w` CSS custom
// property set on the timeline root, so no prop threading is needed.
const DEFAULT_LABEL_W = 680 // px — room for a readable title next to status/owner/due
const LABEL_W_MIN = 200 // px — clamp floor
const LABEL_W_MAX = 1200 // px — clamp ceiling
const LABEL_W_KEY = "goalTimeline.labelW" // localStorage key
// Sticky cells read the width from the CSS variable; sub-components use this
// constant rather than repeating the string literal.
const LABEL_W_VAR = "var(--gt-label-w)"

const ROW_H = 40 // px — one initiative / task row
const AXIS_H = 40 // px — month header height

function clampLabelW(w: number): number {
  if (Number.isNaN(w)) return DEFAULT_LABEL_W
  return Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, Math.round(w)))
}

function readStoredLabelW(): number {
  if (typeof window === "undefined") return DEFAULT_LABEL_W
  try {
    const raw = window.localStorage.getItem(LABEL_W_KEY)
    if (raw === null) return DEFAULT_LABEL_W
    const n = Number.parseInt(raw, 10)
    return Number.isNaN(n) ? DEFAULT_LABEL_W : clampLabelW(n)
  } catch {
    return DEFAULT_LABEL_W
  }
}

// ---------------------------------------------------------------------------
// Custom tooltip (Change 2). Native `title` attributes are slow (~1s browser
// delay) and unstyled. Task dots instead report hover to the island, which
// renders one fixed-position tooltip near the cursor — outside the timeline's
// overflow-x-auto container, so it is never clipped.
// ---------------------------------------------------------------------------

interface TooltipState {
  title: string
  meta: string
  x: number
  y: number
}

// Handlers threaded down to TaskDots so a dot can raise/clear the tooltip.
interface TaskHoverHandlers {
  onEnter: (title: string, meta: string, e: { clientX: number; clientY: number }) => void
  onMove: (e: { clientX: number; clientY: number }) => void
  onLeave: () => void
}

// ===========================================================================
// Sub-components
// ===========================================================================

function AxisHeader({
  domain,
  months,
  weeks,
  todayMs,
  goalMilestones,
  language,
}: {
  domain: Domain
  months: MonthTick[]
  weeks: WeekTick[]
  todayMs: number
  goalMilestones: { leftPct: number; title: string; date: string }[]
  language: string
}) {
  return (
    <div
      className="relative border-b border-border bg-background"
      style={{ height: AXIS_H, width: domain.width }}
    >
      {weeks.map((w, i) => (
        <div
          key={`w${i}`}
          className="absolute top-0 bottom-0 w-px bg-border/40"
          style={{ left: `${w.leftPct}%` }}
        />
      ))}
      {months.map((mo, i) => (
        <div
          key={`m${i}`}
          className="absolute top-0 bottom-0 border-l border-border"
          style={{ left: `${mo.leftPct}%` }}
        >
          <span className="ml-1.5 inline-block whitespace-nowrap py-1 text-xs font-medium text-muted-foreground">
            {mo.label}
          </span>
        </div>
      ))}
      {goalMilestones.map((g, i) => (
        <div
          key={`gm${i}`}
          className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${g.leftPct}%` }}
          title={`${g.title} — target ${formatDisplayDate(g.date, language)}`}
        >
          <div className="h-2.5 w-2.5 rotate-45 border border-sky-600 bg-sky-400" />
        </div>
      ))}
      {/* Today marker */}
      <div
        className="absolute top-0 bottom-0 z-10 w-px bg-red-500"
        style={{ left: `${leftPct(todayMs, domain)}%` }}
      >
        <span className="absolute top-0 left-1 rounded-sm bg-red-500 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
          Today
        </span>
      </div>
    </div>
  )
}

function TodayLine({ domain, todayMs }: { domain: Domain; todayMs: number }) {
  return (
    <div
      className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-red-500/60"
      style={{ left: `${leftPct(todayMs, domain)}%` }}
    />
  )
}

function WeekGrid({ weeks }: { weeks: WeekTick[] }) {
  return (
    <>
      {weeks.map((w, i) => (
        <div
          key={`wg${i}`}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/30"
          style={{ left: `${w.leftPct}%` }}
        />
      ))}
    </>
  )
}

function InitiativeBar({
  init,
  domain,
  todayMs,
  language,
}: {
  init: TimelineInitiative
  domain: Domain
  todayMs: number
  language: string
}) {
  const start = parseDay(init.timeline_start)
  const end = parseDay(init.timeline_end)
  const barCls = initiativeBarClass(init.status)
  const atRisk =
    end !== null && todayMs > end && init.status !== "done"
      ? "ring-2 ring-red-500 ring-offset-1 ring-offset-background"
      : ""

  // start + end → bar
  if (start !== null && end !== null) {
    const l = leftPct(start, domain)
    const r = leftPct(end, domain)
    const w = Math.max(r - l, 0.4)
    return (
      <a
        href={artifactHref(init.id)}
        data-astro-reload
        className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded border px-1.5 text-[11px] font-medium text-white/95 hover:brightness-110 ${barCls} ${atRisk}`}
        style={{ left: `${l}%`, width: `${w}%`, minWidth: 18 }}
        title={`${init.title}\n${formatDisplayDate(init.timeline_start!, language)} → ${formatDisplayDate(init.timeline_end!, language)}`}
      >
        <span className="truncate">{init.title}</span>
      </a>
    )
  }

  // end only → diamond milestone
  if (end !== null) {
    return (
      <a
        href={artifactHref(init.id)}
        data-astro-reload
        className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${leftPct(end, domain)}%` }}
        title={`${init.title} — ${formatDisplayDate(init.timeline_end!, language)}`}
      >
        <div className={`h-3 w-3 rotate-45 border ${barCls} ${atRisk}`} />
      </a>
    )
  }

  return null
}

// Product-initiative markers for the sticky label cell: PRD link (D2), scope
// change chip (D5) and the red gap flag (D6). Renders nothing for other kinds.
function ProductMarkers({
  init,
  todayMs,
  hover,
}: {
  init: TimelineInitiative
  todayMs: number
  hover: TaskHoverHandlers
}) {
  if (!isProduct(init)) return null
  const gaps = productGaps(init, todayMs)
  const scope = scopeChange(init)
  const added = scope?.added.size ?? 0
  const removed = scope?.removed.length ?? 0
  const scopeLabel = [added > 0 && `+${added}`, removed > 0 && `−${removed}`]
    .filter(Boolean)
    .join(" ")
  return (
    <>
      {init.prd_doc && (
        <a
          href={init.prd_doc}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex shrink-0 items-center rounded border border-border px-1 py-0.5 text-[9px] font-medium text-muted-foreground hover:text-foreground hover:underline"
          title="Open PRD (x_prd_doc)"
        >
          PRD ↗
        </a>
      )}
      {scope && scopeLabel && (
        <span
          className="inline-flex shrink-0 cursor-default items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-800"
          aria-label={`Scope changed since kickoff: ${added} added, ${removed} removed`}
          onMouseEnter={(e) =>
            hover.onEnter(
              `Scope changed since kickoff ${scope.kickoff}`,
              `${added} added after kickoff · ${removed} baseline removed, archived or unlinked`,
              e
            )
          }
          onMouseMove={(e) => hover.onMove(e)}
          onMouseLeave={hover.onLeave}
        >
          {scopeLabel}
        </span>
      )}
      {gaps.length > 0 && (
        <span
          className="inline-flex shrink-0 cursor-default items-center gap-0.5 rounded bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-800"
          aria-label={`${gaps.length} kickoff gaps`}
          onMouseEnter={(e) =>
            hover.onEnter(
              `Product kickoff gaps (${gaps.length})`,
              tooltipLines(gaps),
              e
            )
          }
          onMouseMove={(e) => hover.onMove(e)}
          onMouseLeave={hover.onLeave}
        >
          ⚑ {gaps.length}
        </span>
      )}
    </>
  )
}

// De-emphasised dot palette used when the owning initiative is expanded
// (Change 4). The table becomes the primary detail; dots drop to a light
// positional reference. Overdue/done are hinted faintly, everything else is
// a neutral grey. Opacity is applied on the wrapper for extra subtlety.
const DUE_DOT_DIMMED: Record<DueState, string> = {
  overdue: "bg-red-400/50 border-red-400/50",
  soon: "bg-muted-foreground/40 border-muted-foreground/40",
  done: "bg-muted-foreground/30 border-muted-foreground/30",
  neutral: "bg-muted-foreground/30 border-muted-foreground/30",
}

// ===========================================================================
// Main component
// ===========================================================================

// ---------------------------------------------------------------------------
// Roadmap view helpers: kind lanes, owner filter, zoom
// ---------------------------------------------------------------------------

type Zoom = "week" | "month" | "quarter"
const ZOOM_PX_PER_DAY: Record<Zoom, number> = { week: 24, month: 9, quarter: 4 }
const ZOOM_LABEL: Record<Zoom, string> = { week: "Weeks", month: "Months", quarter: "Quarters" }

const KIND_LANES: { kind: TimelineInitiative["initiative_kind"]; title: string }[] = [
  { kind: "product", title: "Product" },
  { kind: "business", title: "Business" },
  { kind: "marketing", title: "Marketing" },
  { kind: "ops", title: "Ops" },
  { kind: null, title: "Unclassified" },
]
const HIDDEN_INITIATIVE_STATUSES = new Set(["archived", "cancelled"])

const FINISHED_INITIATIVE_STATUSES = new Set(["done", "archived", "cancelled"])

function isFinished(i: TimelineInitiative): boolean {
  return !!i.status && FINISHED_INITIATIVE_STATUSES.has(i.status)
}

// Open work first, then by start date.
function byScheduleThenTitle(a: TimelineInitiative, b: TimelineInitiative): number {
  if (isFinished(a) !== isFinished(b)) return isFinished(a) ? 1 : -1
  const as = a.timeline_start ?? a.timeline_end ?? "9999"
  const bs = b.timeline_start ?? b.timeline_end ?? "9999"
  return as === bs ? a.title.localeCompare(b.title) : as < bs ? -1 : 1
}

// One lane per initiative kind. An initiative contributing to several goals
// appears once; archived and cancelled initiatives are left out.
function groupByKind(data: RoadmapProp): RoadmapProp {
  const seen = new Map<string, TimelineInitiative>()
  for (const g of data.goals) for (const i of g.initiatives) seen.set(i.id, i)
  for (const i of data.noGoal) seen.set(i.id, i)
  const all = [...seen.values()].filter(
    (i) => !i.status || !HIDDEN_INITIATIVE_STATUSES.has(i.status)
  )
  const goals = KIND_LANES.map(({ kind, title }) => ({
    goal: {
      id: `kind:${kind ?? "none"}`,
      title,
      status: null,
      target_date: null,
      metric: null,
      target: null,
      current: null,
      synthetic: true,
    },
    initiatives: all
      .filter((i) => (i.initiative_kind ?? null) === kind)
      .sort(byScheduleThenTitle),
  })).filter((g) => g.initiatives.length > 0)
  return { goals, noGoal: [] }
}

function filterByOwner(data: RoadmapProp, owner: string): RoadmapProp {
  if (!owner) return data
  const keep = (i: TimelineInitiative) => i.owner === owner
  return {
    goals: data.goals
      .map((g) => ({ ...g, initiatives: g.initiatives.filter(keep) }))
      .filter((g) => !g.goal.synthetic || g.initiatives.length > 0),
    noGoal: data.noGoal.filter(keep),
  }
}

// Eisenhower quadrants (decision_adr-replace-p0-p3-priority-wit) plus the
// tasks nobody has classified yet, and an escape hatch to see everything.
type PriorityView = "do" | "plan" | "routine" | "drop" | "none" | "all"
const PRIORITY_VIEWS: { key: PriorityView; label: string; hint: string }[] = [
  { key: "do", label: "Do", hint: "Important + urgent" },
  { key: "plan", label: "Plan", hint: "Important, not urgent" },
  { key: "routine", label: "Routine", hint: "Urgent, not important" },
  { key: "drop", label: "Drop", hint: "Neither" },
  { key: "none", label: "Unclassified", hint: "Open tasks with no priority" },
  { key: "all", label: "All", hint: "Every initiative, all tasks" },
]
const PRIORITY_PARAM = "priority"

function readPriorityView(): PriorityView {
  if (typeof window === "undefined") return "do"
  const v = new URLSearchParams(window.location.search).get(PRIORITY_PARAM)
  return PRIORITY_VIEWS.some((p) => p.key === v) ? (v as PriorityView) : "do"
}

function isOpenTask(t: TimelineTask): boolean {
  return !t.status || !CLOSED_TASK_STATUSES.has(t.status)
}

function matchesPriority(t: TimelineTask, view: PriorityView): boolean {
  return isOpenTask(t) && (t.priority ?? "none") === view
}

// Keep the open tasks in one quadrant, and the open initiatives that hold such
// a task or carry that priority themselves. Goals with nothing left drop out.
function filterByPriority(data: RoadmapProp, view: PriorityView): RoadmapProp {
  if (view === "all") return data
  const pick = (i: TimelineInitiative): TimelineInitiative | null => {
    if (i.status && HIDDEN_INITIATIVE_STATUSES.has(i.status)) return null
    const tasks = i.tasks.filter((t) => matchesPriority(t, view))
    const own = !isFinished(i) && (i.priority ?? "none") === view && view !== "none"
    return tasks.length > 0 || own ? { ...i, tasks } : null
  }
  const keep = (list: TimelineInitiative[]) =>
    list.map(pick).filter((i): i is TimelineInitiative => i !== null).sort(byScheduleThenTitle)
  return {
    goals: data.goals
      .map((g) => ({ ...g, initiatives: keep(g.initiatives) }))
      .filter((g) => g.initiatives.length > 0),
    noGoal: keep(data.noGoal),
  }
}

// Open tasks per quadrant, counted once even when an initiative sits under
// several goals.
function countByPriority(data: RoadmapProp): Record<PriorityView, number> {
  const out: Record<PriorityView, number> = { do: 0, plan: 0, routine: 0, drop: 0, none: 0, all: 0 }
  const seen = new Set<string>()
  for (const i of allInitiatives(data)) {
    for (const t of i.tasks) {
      if (seen.has(t.id) || !isOpenTask(t)) continue
      seen.add(t.id)
      out[(t.priority ?? "none") as PriorityView]++
      out.all++
    }
  }
  return out
}

function expandWithTasks(data: RoadmapProp): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const i of allInitiatives(data)) if (i.tasks.length > 0) out[i.id] = true
  return out
}

function allInitiatives(data: RoadmapProp): TimelineInitiative[] {
  return [...data.goals.flatMap((g) => g.initiatives), ...data.noGoal]
}

// Roadmap opens with the planned product work unfolded: open initiatives that
// kicked off or whose tasks carry a schedule.
function defaultExpanded(data: RoadmapProp): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const i of allInitiatives(data)) {
    if (isFinished(i)) continue
    if (i.kickoff_date || i.tasks.some((t) => t.start_date || t.target_date)) out[i.id] = true
  }
  return out
}

export default function GoalTimeline({
  data: input,
  today,
  language,
  groupBy = "goal",
  priorityTabs = false,
}: Props) {
  const [zoom, setZoom] = useState<Zoom>("month")
  const [owner, setOwner] = useState("")
  const [priority, setPriority] = useState<PriorityView>(() =>
    priorityTabs ? readPriorityView() : "all"
  )
  const grouped = groupBy === "kind" ? groupByKind(input) : input
  const priorityCounts = countByPriority(grouped)
  const owners = [...new Set(allInitiatives(grouped).map((i) => i.owner).filter((o): o is string => !!o))].sort()
  const data = filterByOwner(filterByPriority(grouped, priority), owner)
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    priorityTabs && priority !== "all"
      ? expandWithTasks(filterByPriority(grouped, priority))
      : groupBy === "kind"
        ? defaultExpanded(grouped)
        : {}
  )
  const choosePriority = (view: PriorityView) => {
    setPriority(view)
    setExpanded(view === "all" ? {} : expandWithTasks(filterByPriority(grouped, view)))
    const url = new URL(window.location.href)
    url.searchParams.set(PRIORITY_PARAM, view)
    window.history.replaceState(window.history.state, "", url)
  }
  // `today` is always supplied by the page (frontmatter computes it); the ??
  // fallback is defensive only. Parse of a literal keeps render pure — no
  // Date.now() side effect on the render path.
  const todayMs = parseDay(today) ?? parseDay("2026-01-01")!

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  // --- Change 1: resizable sticky left column ------------------------------
  // This island is client:only (no SSR pass), so a lazy initializer may read
  // localStorage directly with no hydration-mismatch risk. Falls back to
  // DEFAULT_LABEL_W (= 264 × 1.5). The live value is published to descendants
  // via the `--gt-label-w` CSS variable on the root container.
  const [labelW, setLabelW] = useState<number>(readStoredLabelW)

  // Drag bookkeeping lives in refs so the document-level move handler always
  // sees fresh values without re-subscribing on every mouse move.
  const dragStartX = useRef(0)
  const dragStartW = useRef(labelW)
  const [dragging, setDragging] = useState(false)

  const onHandleMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      dragStartX.current = e.clientX
      dragStartW.current = labelW
      setDragging(true)

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartX.current
        setLabelW(clampLabelW(dragStartW.current + dx))
      }
      const onUp = () => {
        setDragging(false)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
        // Persist the settled width (read from state via the functional form
        // to avoid a stale closure).
        setLabelW((w) => {
          try {
            window.localStorage.setItem(LABEL_W_KEY, String(w))
          } catch {
            /* storage may be unavailable (private mode / quota) — ignore */
          }
          return w
        })
      }
      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [labelW]
  )

  // --- Change 2: single island-level custom tooltip ------------------------
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const hover: TaskHoverHandlers = {
    onEnter: (title, meta, e) =>
      setTooltip({ title, meta, x: e.clientX, y: e.clientY }),
    onMove: (e) =>
      setTooltip((prev) =>
        prev ? { ...prev, x: e.clientX, y: e.clientY } : prev
      ),
    onLeave: () => setTooltip(null),
  }

  const domain = computeDomain(data, todayMs, ZOOM_PX_PER_DAY[zoom])
  const { months, weeks } = buildTicks(domain, language)

  // Open on today, not on the earliest start date. The Goals page mounts this
  // island hidden behind the Table tab, so jump once the container has a width.
  const scrollRef = useRef<HTMLDivElement>(null)
  const jumpedFor = useRef<string | null>(null)
  const todayX = ((todayMs - domain.min) / DAY_MS) * domain.pxPerDay
  const scrollToToday = useCallback(() => {
    const el = scrollRef.current
    if (!el || el.clientWidth === 0) return false
    el.scrollLeft = Math.max(0, todayX - 0.3 * (el.clientWidth - labelW))
    return true
  }, [todayX, labelW])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const jump = () => {
      if (jumpedFor.current === zoom) return
      if (scrollToToday()) jumpedFor.current = zoom
    }
    jump()
    const ro = new ResizeObserver(jump)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom, scrollToToday])

  const expandAll = () => setExpanded(expandWithTasks(data))

  const hasGoals = data.goals.length > 0
  const hasNoGoal = data.noGoal.length > 0

  const tabs = priorityTabs ? (
    <div className="mb-3 flex flex-wrap items-center gap-1" role="tablist" aria-label="Priority">
      {PRIORITY_VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          role="tab"
          aria-selected={priority === v.key}
          title={v.hint}
          onClick={() => choosePriority(v.key)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors ${
            priority === v.key
              ? "border-foreground/20 bg-muted text-foreground"
              : "border-border bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          {v.label}
          <span className="font-mono text-xs text-muted-foreground">{priorityCounts[v.key]}</span>
        </button>
      ))}
      <span className="ml-2 text-xs text-muted-foreground">
        {PRIORITY_VIEWS.find((v) => v.key === priority)?.hint} · open tasks
      </span>
    </div>
  ) : null

  // Empty state: no goals at all AND nothing in the no-goal bucket.
  if (!hasGoals && !hasNoGoal) {
    return (
      <>
        {tabs}
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
          <div className="text-4xl text-muted-foreground/60">○</div>
          <p className="mt-3 text-sm text-muted-foreground">
            {priorityTabs && priority !== "all"
              ? "No open work in this priority."
              : "No goals or initiatives to place on the roadmap yet."}
          </p>
        </div>
      </>
    )
  }

  // Does anything at all have a bar/point date? Drives the first-load hint.
  const anyDated =
    data.goals.some((g) =>
      g.initiatives.some(
        (i) => i.timeline_start || i.timeline_end
      )
    ) || data.noGoal.some((i) => i.timeline_start || i.timeline_end)

  // Goal target-date milestones for the axis header.
  const goalMilestones = data.goals
    .map((g) => {
      const gd = parseDay(g.goal.target_date)
      return gd === null
        ? null
        : {
            leftPct: leftPct(gd, domain),
            title: g.goal.title,
            date: g.goal.target_date as string,
          }
    })
    .filter((x): x is { leftPct: number; title: string; date: string } => x !== null)

  return (
    <>
      {tabs}
      {/* Desktop timeline (md+). The CSS custom property publishes the live
          left-column width to every sticky cell below. */}
      <div
        className="hidden md:block"
        style={{ "--gt-label-w": `${labelW}px` } as CSSProperties}
      >
        {!anyDated && (
          <p className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Nothing is scheduled yet. Goal target dates appear as{" "}
            <span className="inline-block h-2 w-2 rotate-45 border border-sky-600 bg-sky-400 align-middle" />{" "}
            markers on the axis. Set an initiative&rsquo;s{" "}
            <code className="rounded bg-background px-1">x_timeline_end</code> to
            schedule it as a bar or point on the roadmap.
          </p>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Zoom">
            {(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoom(z)}
                aria-pressed={zoom === z}
                className={`rounded px-2 py-0.5 font-medium ${zoom === z ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={scrollToToday}
            className="rounded-md border border-border bg-card px-2 py-1 font-medium text-muted-foreground hover:text-foreground"
          >
            Today
          </button>
          <button
            type="button"
            onClick={expandAll}
            className="rounded-md border border-border bg-card px-2 py-1 font-medium text-muted-foreground hover:text-foreground"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={() => setExpanded({})}
            className="rounded-md border border-border bg-card px-2 py-1 font-medium text-muted-foreground hover:text-foreground"
          >
            Collapse all
          </button>
          <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            Owner
            <select
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="rounded-md border border-border bg-card px-1.5 py-1 text-foreground"
            >
              <option value="">Everyone</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="relative">
        {/* Drag handle on the label column's right border, the full height of
            the timeline. It sits outside the horizontal scroller: the label
            column is sticky, so its border never moves when the axis scrolls. */}
        <div
          className="pointer-events-none absolute inset-y-0 z-40"
          style={{ left: `calc(${LABEL_W_VAR} + 1px)` }}
        >
          <ResizeHandle active={dragging} onMouseDown={onHandleMouseDown} />
        </div>
        <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-border">
          <div style={{ minWidth: `calc(${LABEL_W_VAR} + ${domain.width}px)` }}>
            {/* Header row: label spacer + axis */}
            <div className="flex">
              <div
                className="sticky left-0 z-30 shrink-0 border-b border-r border-border bg-background"
                style={{ width: LABEL_W_VAR, height: AXIS_H }}
              />
              <div className="shrink-0">
                <AxisHeader
                  domain={domain}
                  months={months}
                  weeks={weeks}
                  todayMs={todayMs}
                  goalMilestones={goalMilestones}
                  language={language}
                />
              </div>
            </div>

            {/* Goal sections */}
            {data.goals.map((group) => (
              <GoalSection
                key={group.goal.id}
                group={group}
                domain={domain}
                weeks={weeks}
                todayMs={todayMs}
                language={language}
                expanded={expanded}
                toggle={toggle}
                hover={hover}
              />
            ))}

            {/* No goal group */}
            {hasNoGoal && (
              <NoGoalSection
                initiatives={data.noGoal}
                domain={domain}
                weeks={weeks}
                todayMs={todayMs}
                language={language}
                expanded={expanded}
                toggle={toggle}
                hover={hover}
              />
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Compact fallback (below md) */}
      <div className="md:hidden">
        <MobileFallback data={data} todayMs={todayMs} language={language} />
      </div>

      {/* Change 2: single fixed-position tooltip, rendered outside the
          overflow-x-auto scroll container so it is never clipped. */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-md"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
          role="tooltip"
        >
          <div className="font-semibold leading-snug">{tooltip.title}</div>
          <div className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">
            {tooltip.meta}
          </div>
        </div>
      )}

      {/* While dragging, an overlay captures the cursor so text selection and
          iframe/hover artefacts don't interfere with the resize. */}
      {dragging && (
        <div className="fixed inset-0 z-40 cursor-col-resize select-none" />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Resize handle (Change 1)
// ---------------------------------------------------------------------------

function ResizeHandle({
  active,
  onMouseDown,
}: {
  active: boolean
  onMouseDown: (e: ReactMouseEvent) => void
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize label column"
      onMouseDown={onMouseDown}
      className={`pointer-events-auto absolute inset-y-0 left-0 w-2 -translate-x-1/2 cursor-col-resize ${
        active ? "bg-sky-500/70" : "bg-transparent hover:bg-sky-500/40"
      }`}
    />
  )
}

// ---------------------------------------------------------------------------
// Goal section (desktop)
// ---------------------------------------------------------------------------

function GoalSection({
  group,
  domain,
  weeks,
  todayMs,
  language,
  expanded,
  toggle,
  hover,
}: {
  group: TimelineGoalGroup
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  expanded: Record<string, boolean>
  toggle: (id: string) => void
  hover: TaskHoverHandlers
}) {
  const { goal, initiatives } = group
  const scheduled = initiatives.filter(
    (i) => i.timeline_start || i.timeline_end
  )
  const unscheduled = initiatives.filter(
    (i) => !i.timeline_start && !i.timeline_end
  )

  const metricLine = goal.synthetic
    ? `${initiatives.length} initiatives · ${scheduled.length} with dates`
    : [
        goal.metric && `${goal.metric}`,
        goal.current && `now ${goal.current}`,
        goal.target && `target ${goal.target}`,
      ]
        .filter(Boolean)
        .join(" · ")

  return (
    <div className="border-b border-border">
      {/* Goal header row */}
      <div className="flex bg-muted/30">
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-muted/60 px-3 py-2"
          style={{ width: LABEL_W_VAR }}
        >
          {goal.synthetic ? (
            <div className="truncate text-sm font-semibold text-foreground">{goal.title}</div>
          ) : (
            <div className="flex items-center gap-2">
              <a
                href={artifactHref(goal.id)}
                data-astro-reload
                className="truncate text-sm font-semibold text-foreground hover:underline"
                title={goal.title}
              >
                {goal.title}
              </a>
              <span
                className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${goalStatusClass(goal.status)}`}
              >
                {goal.status ?? "—"}
              </span>
            </div>
          )}
          {metricLine && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {metricLine}
            </div>
          )}
        </div>
        <div className="relative shrink-0" style={{ width: domain.width }}>
          <WeekGrid weeks={weeks} />
          <TodayLine domain={domain} todayMs={todayMs} />
          {goal.target_date && parseDay(goal.target_date) !== null && (
            <div
              className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${leftPct(parseDay(goal.target_date)!, domain)}%` }}
              title={`${goal.title} — target ${formatDisplayDate(goal.target_date, language)}`}
            >
              <div className="h-3 w-3 rotate-45 border border-sky-600 bg-sky-400" />
            </div>
          )}
        </div>
      </div>

      {/* No contributing initiatives */}
      {initiatives.length === 0 && (
        <div className="flex">
          <div
            className="sticky left-0 z-10 shrink-0 border-r border-border bg-card px-3 py-2 text-xs text-muted-foreground"
            style={{ width: LABEL_W_VAR }}
          >
            No contributing initiatives yet.
          </div>
          <div className="relative shrink-0" style={{ width: domain.width }}>
            <WeekGrid weeks={weeks} />
            <TodayLine domain={domain} todayMs={todayMs} />
          </div>
        </div>
      )}

      {/* Scheduled initiatives */}
      {scheduled.map((init) => (
        <InitiativeRow
          key={init.id}
          init={init}
          domain={domain}
          weeks={weeks}
          todayMs={todayMs}
          language={language}
          isExpanded={!!expanded[init.id]}
          toggle={toggle}
          hover={hover}
        />
      ))}

      {/* Unscheduled sublist */}
      {unscheduled.length > 0 && (
        <UnscheduledList
          initiatives={unscheduled}
          domain={domain}
          weeks={weeks}
          todayMs={todayMs}
          language={language}
          expanded={expanded}
          toggle={toggle}
          hover={hover}
        />
      )}
    </div>
  )
}

function NoGoalSection({
  initiatives,
  domain,
  weeks,
  todayMs,
  language,
  expanded,
  toggle,
  hover,
}: {
  initiatives: TimelineInitiative[]
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  expanded: Record<string, boolean>
  toggle: (id: string) => void
  hover: TaskHoverHandlers
}) {
  const scheduled = initiatives.filter(
    (i) => i.timeline_start || i.timeline_end
  )
  const unscheduled = initiatives.filter(
    (i) => !i.timeline_start && !i.timeline_end
  )
  return (
    <div className="border-b border-border">
      <div className="flex bg-muted/30">
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-muted/60 px-3 py-2"
          style={{ width: LABEL_W_VAR }}
        >
          <span className="text-sm font-semibold text-muted-foreground">
            No goal
          </span>
        </div>
        <div className="relative shrink-0" style={{ width: domain.width }}>
          <WeekGrid weeks={weeks} />
          <TodayLine domain={domain} todayMs={todayMs} />
        </div>
      </div>
      {scheduled.map((init) => (
        <InitiativeRow
          key={init.id}
          init={init}
          domain={domain}
          weeks={weeks}
          todayMs={todayMs}
          language={language}
          isExpanded={!!expanded[init.id]}
          toggle={toggle}
          hover={hover}
        />
      ))}
      {unscheduled.length > 0 && (
        <UnscheduledList
          initiatives={unscheduled}
          domain={domain}
          weeks={weeks}
          todayMs={todayMs}
          language={language}
          expanded={expanded}
          toggle={toggle}
          hover={hover}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Initiative row + expanded task rows (desktop)
// ---------------------------------------------------------------------------

function InitiativeRow({
  init,
  domain,
  weeks,
  todayMs,
  language,
  isExpanded,
  toggle,
  hover,
}: {
  init: TimelineInitiative
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  isExpanded: boolean
  toggle: (id: string) => void
  hover: TaskHoverHandlers
}) {
  const badge = statusBadge(init.status)
  const hasTasks = init.tasks.length > 0
  return (
    <>
      <div className="flex hover:bg-muted/40">
        <div
          onClick={() => hasTasks && toggle(init.id)}
          className={`sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-card px-3 ${hasTasks ? "cursor-pointer" : ""}`}
          style={{ width: LABEL_W_VAR, minHeight: ROW_H }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (hasTasks) toggle(init.id)
            }}
            className={`shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-90" : ""} ${hasTasks ? "cursor-pointer hover:text-foreground" : "cursor-default opacity-30"}`}
            aria-label={isExpanded ? "Collapse tasks" : "Expand tasks"}
            aria-expanded={isExpanded}
          >
            ▸
          </button>
          <a
            href={artifactHref(init.id)}
            // Full navigation so Back restores the timeline view (Change 3).
            data-astro-reload
            // Clicking the title navigates to the initiative; keep it from
            // also toggling the row's expand handler.
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 py-1.5 text-sm leading-snug break-words text-foreground hover:underline"
            title={init.title}
          >
            {init.title}
          </a>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <ProductMarkers init={init} todayMs={todayMs} hover={hover} />
            <span
              className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
            >
              {badge.label}
            </span>
          </span>
        </div>
        <div
          className="relative shrink-0 border-b border-border/50"
          style={{ width: domain.width, minHeight: ROW_H }}
        >
          <WeekGrid weeks={weeks} />
          <TodayLine domain={domain} todayMs={todayMs} />
          <InitiativeBar
            init={init}
            domain={domain}
            todayMs={todayMs}
            language={language}
          />
        </div>
      </div>

      {/* Change 4: expanded → one aligned row per task. Left = task cells in
          the sticky column; right = the same row on the axis with that task's
          due-date dot, so each dot lines up with its own table row. */}
      {isExpanded && hasTasks && (
        <ExpandedTaskRows
          init={init}
          domain={domain}
          weeks={weeks}
          todayMs={todayMs}
          language={language}
          hover={hover}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Expanded task table (Change 4). Mirrors the Table view's columns and badge
// styles (StatusBadge / PriorityBadge), rendered as JSX so it lives inside the
// sticky-left region and stays visible while the axis scrolls horizontally.
// ---------------------------------------------------------------------------

function ExpandedTaskRows({
  init,
  domain,
  weeks,
  todayMs,
  language,
  hover,
}: {
  init: TimelineInitiative
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  hover: TaskHoverHandlers
}) {
  // Product initiatives group tasks by component (D3) and mark tasks added
  // after kickoff (D5). Every other kind keeps the flat task list.
  const groups = isProduct(init) ? groupByComponent(init) : null
  const added = scopeChange(init)?.added ?? null
  const row = (t: TimelineTask) => (
    <TaskRow
      key={t.id}
      t={t}
      domain={domain}
      weeks={weeks}
      todayMs={todayMs}
      language={language}
      hover={hover}
      addedAfterKickoff={added?.has(t.id) ?? false}
    />
  )
  return (
    <div className="bg-background/60">
      {/* Column header (left) aligned with an empty axis lane (right). */}
      <div className="flex">
        <div
          className="@container sticky left-0 z-10 flex h-8 shrink-0 items-center border-r border-b border-border/50 bg-background/90 pl-8 pr-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70"
          style={{ width: LABEL_W_VAR }}
        >
          <div className="flex w-full items-center gap-2">
            <span className="min-w-0 flex-1 truncate">Title</span>
            {/* Narrow column: the meta cells wrap under each title instead. */}
            <span className="hidden w-12 shrink-0 text-center @min-[520px]:inline">Prio</span>
            <span className="hidden w-16 shrink-0 text-center @min-[520px]:inline">Status</span>
            <span className="hidden w-14 shrink-0 @min-[520px]:inline">Owner</span>
            <span
              className="hidden w-24 shrink-0 text-right @min-[520px]:inline"
              title="Due date; when unset, → planned target date"
            >
              Due
            </span>
          </div>
        </div>
        <div
          className="relative shrink-0 border-b border-border/50"
          style={{ width: domain.width, height: 32 }}
        >
          <WeekGrid weeks={weeks} />
          <TodayLine domain={domain} todayMs={todayMs} />
        </div>
      </div>

      {groups
        ? groups.map((g) => (
            <div key={g.label}>
              <div className="flex">
                <div
                  className="sticky left-0 z-10 flex h-7 shrink-0 items-center gap-1.5 border-r border-b border-border/50 bg-muted/60 pl-6 pr-3 text-xs font-semibold text-foreground/80"
                  style={{ width: LABEL_W_VAR }}
                >
                  <span
                    className={`min-w-0 truncate pr-1 ${g.label === NO_COMPONENT ? "italic text-muted-foreground" : ""}`}
                    title={g.label}
                  >
                    {g.label}
                  </span>
                  <span className="shrink-0 font-normal text-muted-foreground">
                    {g.tasks.length === 0
                      ? "no tasks"
                      : `${g.tasks.length} ${g.tasks.length === 1 ? "task" : "tasks"}`}
                  </span>
                </div>
                <div
                  className="relative shrink-0 border-b border-border/50 bg-muted/20"
                  style={{ width: domain.width, height: 28 }}
                >
                  <WeekGrid weeks={weeks} />
                  <TodayLine domain={domain} todayMs={todayMs} />
                </div>
              </div>
              {g.tasks.map(row)}
            </div>
          ))
        : init.tasks.map(row)}
    </div>
  )
}

// Task schedule bar/point palette (x_start_date → x_target_date). Slipped =
// open task past its planned target (D3 weekly slip flag).
function scheduleClass(task: TimelineTask, slipped: boolean): string {
  if (slipped) return "bg-red-500/80 border-red-600"
  if (task.status && CLOSED_TASK_STATUSES.has(task.status))
    return "bg-muted-foreground/40 border-muted-foreground/50"
  return "bg-sky-500/70 border-sky-600"
}

// One aligned task row: left cells + right axis lane. A task with start and
// target dates renders as a bar, target-only as a diamond point; the due-date
// dot is kept on top whenever due_date is set.
function TaskRow({
  t,
  domain,
  weeks,
  todayMs,
  language,
  hover,
  addedAfterKickoff,
}: {
  t: TimelineTask
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  hover: TaskHoverHandlers
  addedAfterKickoff: boolean
}) {
  const s = statusBadge(t.status)
  const p = priorityBadge(t.priority)
  const due = parseDay(t.due_date)
  const start = parseDay(t.start_date)
  const target = parseDay(t.target_date)
  const state = taskDueState(t, todayMs)
  const slipped = taskSlipped(t, todayMs)
  const fmt = (v: string | null | undefined) => formatDisplayDate(v!, language)

  const metaParts = [s.label]
  if (t.component) metaParts.push(t.component)
  if (start !== null && target !== null)
    metaParts.push(`${fmt(t.start_date)} → ${fmt(t.target_date)}`)
  else if (target !== null) metaParts.push(`target ${fmt(t.target_date)}`)
  if (due !== null) metaParts.push(`due ${fmt(t.due_date)}`)
  if (slipped) metaParts.push("slipped past target")
  if (addedAfterKickoff) metaParts.push("added after kickoff")
  const meta = metaParts.join(" · ")

  const hoverProps = {
    onMouseEnter: (e: ReactMouseEvent) => hover.onEnter(t.title, meta, e),
    onMouseMove: (e: ReactMouseEvent) => hover.onMove(e),
    onMouseLeave: hover.onLeave,
  }
  const schedCls = scheduleClass(t, slipped)

  return (
    <div className="flex hover:bg-muted/40">
      <div
        className="@container sticky left-0 z-10 flex min-h-9 shrink-0 items-center border-r border-b border-border/50 bg-background/90 py-1.5 pl-8 pr-3 text-[13px]"
        style={{ width: LABEL_W_VAR }}
      >
        {/* Wide column: title | prio | status | owner | due on one line.
            Narrow column (< 520px): the title takes the full line and the
            meta cells wrap beneath it, so the title never gets squeezed. */}
        <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex min-w-0 basis-full items-baseline gap-1.5 @min-[520px]:basis-0 @min-[520px]:flex-1">
            <a
              href={taskHref(t.id)}
              data-astro-reload
              className="min-w-0 leading-snug break-words text-foreground hover:underline"
              title={t.title}
            >
              {t.title}
            </a>
            {addedAfterKickoff && (
              <span
                className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                title="Added after kickoff (not in x_baseline_tasks)"
              >
                + added
              </span>
            )}
          </span>
          <span className="inline-flex w-12 shrink-0 justify-center">
            {t.priority && (
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${p.cls}`}
                title={`priority: ${p.label}`}
              >
                {p.label}
              </span>
            )}
          </span>
          <span
            className={`inline-flex w-16 shrink-0 items-center justify-center rounded px-1 py-0.5 text-[11px] font-medium ${s.cls}`}
          >
            {s.label}
          </span>
          <span className="w-14 shrink-0 truncate text-xs text-muted-foreground" title={t.owner ?? undefined}>
            {t.owner ?? "—"}
          </span>
          {due !== null ? (
            <span className="w-24 shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground">
              {fmt(t.due_date)}
            </span>
          ) : target !== null ? (
            <span
              className={`w-24 shrink-0 whitespace-nowrap text-right text-xs italic ${slipped ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
              title={slipped ? "Planned target passed (slipped)" : "Planned target (x_target_date)"}
            >
              → {fmt(t.target_date)}
            </span>
          ) : (
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">—</span>
          )}
        </div>
      </div>
      <div
        className="relative shrink-0 border-b border-border/50"
        style={{ width: domain.width, minHeight: 36 }}
      >
        <WeekGrid weeks={weeks} />
        <TodayLine domain={domain} todayMs={todayMs} />

        {/* Slip tail: dashed red segment from the missed target to today. */}
        {slipped && target !== null && (
          <div
            className="pointer-events-none absolute top-1/2 h-0 border-t border-dashed border-red-500"
            style={{
              left: `${leftPct(target, domain)}%`,
              width: `${Math.max(leftPct(todayMs, domain) - leftPct(target, domain), 0)}%`,
            }}
          />
        )}

        {start !== null && target !== null ? (
          <a
            href={taskHref(t.id)}
            data-astro-reload
            className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full border hover:brightness-110 ${schedCls}`}
            style={{
              left: `${leftPct(Math.min(start, target), domain)}%`,
              width: `${Math.max(leftPct(Math.max(start, target), domain) - leftPct(Math.min(start, target), domain), 0.4)}%`,
              minWidth: 8,
            }}
            {...hoverProps}
          />
        ) : target !== null ? (
          <a
            href={taskHref(t.id)}
            data-astro-reload
            className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${leftPct(target, domain)}%` }}
            {...hoverProps}
          >
            <div className={`h-2.5 w-2.5 rotate-45 border hover:scale-125 ${schedCls}`} />
          </a>
        ) : null}

        {due !== null ? (
          <a
            href={taskHref(t.id)}
            data-astro-reload
            className="group absolute top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 opacity-70 hover:opacity-100"
            style={{ left: `${leftPct(due, domain)}%` }}
            {...hoverProps}
          >
            <div
              className={`h-2.5 w-2.5 rounded-full border ${DUE_DOT_DIMMED[state]} hover:scale-125`}
            />
          </a>
        ) : target === null ? (
          <span className="absolute top-1/2 left-1 -translate-y-1/2 rounded-sm bg-muted px-1 py-0.5 text-[11px] text-muted-foreground/70">
            no date
          </span>
        ) : null}
      </div>
    </div>
  )
}

function UnscheduledList({
  initiatives,
  domain,
  weeks,
  todayMs,
  language,
  expanded,
  toggle,
  hover,
}: {
  initiatives: TimelineInitiative[]
  domain: Domain
  weeks: WeekTick[]
  todayMs: number
  language: string
  expanded: Record<string, boolean>
  toggle: (id: string) => void
  hover: TaskHoverHandlers
}) {
  return (
    <>
      <div className="flex">
        <div
          className="sticky left-0 z-10 shrink-0 border-r border-border bg-card px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70"
          style={{ width: LABEL_W_VAR }}
        >
          Unscheduled
        </div>
        <div className="relative shrink-0" style={{ width: domain.width }}>
          <WeekGrid weeks={weeks} />
          <TodayLine domain={domain} todayMs={todayMs} />
        </div>
      </div>
      {initiatives.map((init) => {
        const derived = maxTaskDue(init.tasks)
        const hint = derived
          ? `tasks suggest ~${formatDisplayDate(derived, language)}`
          : "no dates"
        const badge = statusBadge(init.status)
        // Undated initiatives still unfold, so their tasks' own dates show.
        const hasTasks = init.tasks.length > 0
        const isExpanded = !!expanded[init.id]
        return (
          <div key={init.id}>
          <div className="flex hover:bg-muted/40">
            <div
              onClick={() => hasTasks && toggle(init.id)}
              className={`sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border bg-card py-1.5 pl-3 pr-3 ${hasTasks ? "cursor-pointer" : ""}`}
              style={{ width: LABEL_W_VAR }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (hasTasks) toggle(init.id)
                }}
                className={`shrink-0 text-muted-foreground/60 transition-transform ${isExpanded ? "rotate-90" : ""} ${hasTasks ? "cursor-pointer hover:text-foreground" : "cursor-default opacity-30"}`}
                aria-label={isExpanded ? "Collapse tasks" : "Expand tasks"}
                aria-expanded={isExpanded}
              >
                ▸
              </button>
              <a
                onClick={(e) => e.stopPropagation()}
                href={artifactHref(init.id)}
                data-astro-reload
                className="min-w-0 text-[13px] leading-snug break-words text-muted-foreground hover:text-foreground hover:underline"
                title={init.title}
              >
                {init.title}
              </a>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <ProductMarkers init={init} todayMs={todayMs} hover={hover} />
                <span
                  className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </span>
            </div>
            <div className="relative flex shrink-0 items-center" style={{ width: domain.width }}>
              <WeekGrid weeks={weeks} />
              <TodayLine domain={domain} todayMs={todayMs} />
              {/* Next to today, so the hint stays in view after the jump. */}
              <span
                className="absolute z-[1] whitespace-nowrap pl-2 text-[11px] italic text-muted-foreground/60"
                style={{ left: `${leftPct(todayMs, domain)}%` }}
              >
                {hint}
              </span>
            </div>
          </div>
          {isExpanded && hasTasks && (
            <ExpandedTaskRows
              init={init}
              domain={domain}
              weeks={weeks}
              todayMs={todayMs}
              language={language}
              hover={hover}
            />
          )}
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Mobile fallback — stacked list, no axis.
// ---------------------------------------------------------------------------

function MobileFallback({
  data,
  todayMs,
  language,
}: {
  data: RoadmapProp
  todayMs: number
  language: string
}) {
  const initiativeLine = (init: TimelineInitiative) => {
    const badge = statusBadge(init.status)
    const scheduled = init.timeline_end || init.timeline_start
    const derived = maxTaskDue(init.tasks)
    const dateLabel = init.timeline_end
      ? formatDisplayDate(init.timeline_end, language)
      : derived
        ? `~${formatDisplayDate(derived, language)}`
        : "no date"
    const gaps = productGaps(init, todayMs)
    return (
      <li key={init.id} className="flex items-center gap-2 py-1.5">
        <a
          href={artifactHref(init.id)}
          className="truncate text-sm text-foreground hover:underline"
          title={init.title}
        >
          {init.title}
        </a>
        {gaps.length > 0 && (
          <span
            className="ml-auto inline-flex shrink-0 items-center rounded bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-800"
            title={`Product kickoff gaps:\n${tooltipLines(gaps)}`}
          >
            ⚑ {gaps.length}
          </span>
        )}
        <span
          className={`${gaps.length > 0 ? "" : "ml-auto "}inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}
        >
          {badge.label}
        </span>
        <span
          className={`shrink-0 text-[11px] ${scheduled ? "text-muted-foreground" : "italic text-muted-foreground/60"}`}
        >
          {dateLabel}
        </span>
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        The timeline needs a wide screen. Here is a compact list — switch to the
        Table view for full detail.
      </p>
      {data.goals.map((group) => (
        <section
          key={group.goal.id}
          className="rounded-lg border border-border bg-card"
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <a
              href={artifactHref(group.goal.id)}
              className="truncate text-sm font-semibold text-foreground hover:underline"
            >
              {group.goal.title}
            </a>
            <span
              className={`ml-auto inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${goalStatusClass(group.goal.status)}`}
            >
              {group.goal.status ?? "—"}
            </span>
          </header>
          <div className="px-3 py-1">
            {group.initiatives.length === 0 ? (
              <p className="py-1.5 text-xs text-muted-foreground">
                No contributing initiatives yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {group.initiatives.map(initiativeLine)}
              </ul>
            )}
          </div>
        </section>
      ))}
      {data.noGoal.length > 0 && (
        <section className="rounded-lg border border-border bg-card">
          <header className="border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-muted-foreground">
              No goal
            </span>
          </header>
          <div className="px-3 py-1">
            <ul className="divide-y divide-border">
              {data.noGoal.map(initiativeLine)}
            </ul>
          </div>
        </section>
      )}
    </div>
  )
}
