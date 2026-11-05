import { useState, useEffect, useCallback } from "react"
import type { SerializedTask } from "@/lib/types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  compareTasksBySort,
  DEFAULT_TASK_SORT,
  normalizeTaskSort,
  PRIORITY_ORDER,
  TASK_SORT_OPTIONS,
  type TaskSortValue,
} from "@/lib/task-sort"
import {
  getTaskDueState,
  getTaskRelationSignals,
  matchesTaskPreset,
  normalizeTaskPreset,
  TASK_PRESETS,
  type TaskPresetValue,
} from "@/lib/task-views"
import TaskActions from "@/components/islands/TaskActions"
import StatusSelect from "@/components/islands/StatusSelect"

interface Props {
  owners: string[]
  iterations: string[]
  areas: string[]
  currentMember: string
  currentIteration: string
  initialTasks: SerializedTask[]
  initialFilters: {
    owner: string
    status: string
    priority: string
    iteration: string
    area: string
    q: string
    preset: string
    sort: string
  }
}

function getParam(key: string): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get(key) ?? ""
}

// initialFilters arrives empty from SSG (Astro prerenders /tasks/ once with no
// search params), so URL filters must be read at first client render. Without
// this, navigating to /tasks/?preset=mine flashes the unfiltered list before
// the URL-sync effect fires.
function resolveInitialFilter(
  fromProps: string,
  paramKey: string
): string {
  return fromProps || getParam(paramKey)
}

function setParam(
  key: string,
  value: string,
  { omitValue = "all" }: { omitValue?: string | null } = {}
) {
  const params = new URLSearchParams(window.location.search)
  if (value && value !== omitValue) {
    params.set(key, value)
  } else {
    params.delete(key)
  }
  const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`
  window.history.replaceState(null, "", newUrl)
}

const STATUS_OPTIONS = [
  "plan",
  "ready",
  "doing",
  "blocked",
  "done",
  "archived",
  "cancelled",
]
const PRIORITY_OPTIONS = ["do", "plan", "routine", "drop"]

const STATUS_LABELS: Record<string, string> = {
  plan: "Planned",
  ready: "Ready",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
  cancelled: "Cancelled",
}

const PRIORITY_COLORS: Record<string, string> = {
  do: "bg-red-100 text-red-800",
  plan: "bg-blue-100 text-blue-800",
  routine: "bg-amber-100 text-amber-800",
  drop: "bg-muted text-muted-foreground",
}

const DUE_COLORS: Record<string, string> = {
  overdue: "bg-red-100 text-red-800",
  due_soon: "bg-amber-100 text-amber-800",
  dated: "bg-muted text-muted-foreground",
  none: "bg-background text-muted-foreground",
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const cls = priority
    ? (PRIORITY_COLORS[priority] ?? "bg-background text-muted-foreground")
    : "bg-background text-muted-foreground"
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {priority ?? "—"}
    </span>
  )
}

function DueBadge({ task }: { task: SerializedTask }) {
  const state = getTaskDueState(task)
  const label =
    state === "none"
      ? "No due date"
      : state === "overdue"
        ? `${task.due_date} overdue`
        : state === "due_soon"
          ? `${task.due_date} due soon`
          : task.due_date
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${DUE_COLORS[state]}`}
    >
      {label}
    </span>
  )
}

function SortHeader({
  label,
  sortValue,
  activeSort,
  setSort,
}: {
  label: string
  sortValue: TaskSortValue
  activeSort: TaskSortValue
  setSort: (sort: TaskSortValue) => void
}) {
  const active = activeSort === sortValue
  return (
    <button
      type="button"
      onClick={() => setSort(sortValue)}
      className={`inline-flex items-center gap-1 font-medium ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className="text-[10px] text-muted-foreground">{active ? "▲" : "↕"}</span>
    </button>
  )
}

type GroupMode = "initiative" | "none"

interface TaskGroup {
  key: string
  initiative: { id: string; title: string } | null
  tasks: SerializedTask[]
}

const NO_INITIATIVE = "__none"

// Initiatives holding the most urgent work come first: best task priority,
// then size. Tasks keep the chosen sort inside each group; loose tasks last.
function groupByInitiative(tasks: SerializedTask[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()
  for (const t of tasks) {
    const key = t.initiative?.id ?? NO_INITIATIVE
    if (!groups.has(key)) groups.set(key, { key, initiative: t.initiative ?? null, tasks: [] })
    groups.get(key)!.tasks.push(t)
  }
  const best = (g: TaskGroup) =>
    Math.min(...g.tasks.map((t) => (t.priority ? (PRIORITY_ORDER[t.priority] ?? 9) : 9)))
  return [...groups.values()].sort((a, b) => {
    if ((a.key === NO_INITIATIVE) !== (b.key === NO_INITIATIVE)) return a.key === NO_INITIATIVE ? 1 : -1
    return (
      best(a) - best(b) ||
      b.tasks.length - a.tasks.length ||
      (a.initiative?.title ?? "").localeCompare(b.initiative?.title ?? "")
    )
  })
}

function priorityCounts(tasks: SerializedTask[]): string {
  const counts = new Map<string, number>()
  for (const t of tasks) counts.set(t.priority ?? "none", (counts.get(t.priority ?? "none") ?? 0) + 1)
  return ["do", "plan", "routine", "drop", "none"]
    .filter((p) => counts.get(p))
    .map((p) => `${counts.get(p)} ${p === "none" ? "unset" : p}`)
    .join(" · ")
}

function GroupHeading({
  group,
  collapsed,
  onToggle,
}: {
  group: TaskGroup
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand group" : "Collapse group"}
        className={`w-4 shrink-0 text-muted-foreground transition-transform hover:text-foreground ${collapsed ? "" : "rotate-90"}`}
      >
        ▸
      </button>
      {group.initiative ? (
        <a
          href={`/artifacts/${group.initiative.id}/`}
          className="text-sm font-semibold text-foreground hover:underline"
        >
          {group.initiative.title}
        </a>
      ) : (
        <span className="text-sm font-semibold text-muted-foreground italic">No initiative</span>
      )}
      <span className="text-xs text-muted-foreground">
        {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"} · {priorityCounts(group.tasks)}
      </span>
    </div>
  )
}

export default function TaskFilter({
  owners,
  iterations,
  areas,
  currentMember,
  currentIteration,
  initialTasks,
  initialFilters,
}: Props) {
  const [tasks, setTasks] = useState<SerializedTask[]>(initialTasks)
  const [loading, setLoading] = useState(false)
  const [owner, setOwner] = useState(() =>
    resolveInitialFilter(initialFilters.owner, "owner")
  )
  const [status, setStatus] = useState(() =>
    resolveInitialFilter(initialFilters.status, "status")
  )
  const [priority, setPriority] = useState(() =>
    resolveInitialFilter(initialFilters.priority, "priority")
  )
  const [iteration, setIteration] = useState(() =>
    resolveInitialFilter(initialFilters.iteration, "iteration")
  )
  const [area, setArea] = useState(() =>
    resolveInitialFilter(initialFilters.area, "area")
  )
  const [search, setSearch] = useState(() =>
    resolveInitialFilter(initialFilters.q, "q")
  )
  const [preset, setPreset] = useState(() =>
    normalizeTaskPreset(resolveInitialFilter(initialFilters.preset, "preset"))
  )
  const [sort, setSort] = useState(() =>
    normalizeTaskSort(resolveInitialFilter(initialFilters.sort, "sort"))
  )
  const [group, setGroup] = useState<GroupMode>(() =>
    getParam("group") === "none" ? "none" : "initiative"
  )
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))

  const refreshTasks = useCallback(async () => {
    try {
      const res = await fetch(`/tasks/data.json?t=${Date.now()}`, {
        cache: "no-store",
      })
      if (!res.ok) return
      const data = (await res.json()) as SerializedTask[]
      setTasks(data)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshTasks()
    })
  }, [refreshTasks])

  useEffect(() => {
    function handleActionComplete() {
      void refreshTasks()
    }

    window.addEventListener("board:action-complete", handleActionComplete)
    return () => {
      window.removeEventListener("board:action-complete", handleActionComplete)
    }
  }, [refreshTasks])

  const update = useCallback(
    (key: string, value: string, setter: (v: string) => void) => {
      setter(value)
      setParam(key, value)
    },
    []
  )

  const updatePreset = useCallback((value: TaskPresetValue) => {
    setPreset(value)
    setParam("preset", value, { omitValue: "open" })
  }, [])

  const updateGroup = useCallback((value: GroupMode) => {
    setGroup(value)
    setParam("group", value, { omitValue: "initiative" })
  }, [])

  const updateSort = useCallback((value: TaskSortValue) => {
    setSort(value)
    setParam("sort", value, { omitValue: DEFAULT_TASK_SORT })
  }, [])

  const resetFilters = useCallback(() => {
    for (const key of [
      "owner",
      "status",
      "priority",
      "iteration",
      "area",
      "q",
      "preset",
      "sort",
      "group",
    ]) {
      setParam(key, "")
    }
    setOwner("")
    setStatus("")
    setPriority("")
    setIteration("")
    setArea("")
    setSearch("")
    setPreset("open")
    setSort(DEFAULT_TASK_SORT)
    setGroup("initiative")
  }, [])

  const copyViewLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [])

  const taskViewHref = useCallback(
    (overrides: Partial<Record<"owner" | "status" | "priority" | "iteration" | "area" | "q" | "preset" | "sort", string>>) => {
      const next = {
        owner,
        status,
        priority,
        iteration,
        area,
        q: search,
        preset,
        sort,
        ...overrides,
      }
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(next)) {
        if (!value) continue
        if (key === "preset" && value === "open") continue
        if (key === "sort" && value === DEFAULT_TASK_SORT) continue
        if (key !== "preset" && key !== "sort" && value === "all") continue
        params.set(key, value)
      }
      return `/tasks/${params.toString() ? "?" + params.toString() : ""}`
    },
    [area, iteration, owner, preset, priority, search, sort, status]
  )

  const filtered = tasks.filter((t) => {
    if (
      !matchesTaskPreset(t, preset, {
        currentMember,
        currentIteration,
        today,
      })
    ) {
      return false
    }
    if (owner && owner !== "all" && t.owner !== owner) return false
    if (status && status !== "all" && t.status !== status) return false
    if (priority && priority !== "all" && t.priority !== priority) return false
    if (iteration && iteration !== "all") {
      if (iteration === "unassigned") {
        if (t.iteration !== null && t.iteration !== undefined) return false
      } else {
        if (t.iteration !== iteration) return false
      }
    }
    if (area && area !== "all" && t.area !== area) return false
    if (search) {
      const q = search.toLowerCase()
      const haystack = [t.title, t.id, t.owner, t.iteration, t.area, ...t.tags]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => compareTasksBySort(a, b, sort))
  const groups: TaskGroup[] =
    group === "initiative"
      ? groupByInitiative(sorted)
      : [{ key: "all", initiative: null, tasks: sorted }]
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  const presetCounts = new Map(
    TASK_PRESETS.map((option) => [
      option.value,
      tasks.filter((task) =>
        matchesTaskPreset(task, option.value, {
          currentMember,
          currentIteration,
          today,
        })
      ).length,
    ])
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {TASK_PRESETS.map((option) => {
          const active = preset === option.value
          return (
            <a
              key={option.value}
              href={taskViewHref({ preset: option.value })}
              onClick={(event) => {
                event.preventDefault()
                updatePreset(option.value)
              }}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {option.label}
              <span
                className={`ml-1 text-xs ${active ? "text-background/70" : "text-muted-foreground"}`}
              >
                {presetCounts.get(option.value) ?? 0}
              </span>
            </a>
          )
        })}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          placeholder="Search tasks..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setParam("q", e.target.value)
          }}
          className="w-48"
        />
        <Select
          value={owner || "all"}
          onValueChange={(v) => update("owner", v, setOwner)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Owner" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All owners</SelectItem>
            {owners.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || "all"}
          onValueChange={(v) => update("status", v, setStatus)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priority || "all"}
          onValueChange={(v) => update("priority", v, setPriority)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={iteration || "all"}
          onValueChange={(v) => update("iteration", v, setIteration)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Iteration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All iterations</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {iterations.map((i) => (
              <SelectItem key={i} value={i}>
                {i}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={area || "all"}
          onValueChange={(v) => update("area", v, setArea)}
        >
          <SelectTrigger className="w-36" aria-label="Area filter">
            <SelectValue placeholder="Area" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All areas</SelectItem>
            {areas.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(v) => {
            const normalized = normalizeTaskSort(v)
            updateSort(normalized)
          }}
        >
          <SelectTrigger className="w-44" aria-label="Sort tasks">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {TASK_SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div
          className="inline-flex rounded border border-border bg-card p-0.5 text-sm"
          role="group"
          aria-label="Group tasks"
        >
          {(
            [
              ["initiative", "By initiative"],
              ["none", "Flat list"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={group === value}
              onClick={() => updateGroup(value)}
              className={`rounded px-2.5 py-1 font-medium ${
                group === value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <a
          href={taskViewHref({ preset: "mine" })}
          onClick={(event) => {
            event.preventDefault()
            updatePreset("mine")
          }}
          className="rounded border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          My tasks
        </a>
        <a
          href="/tasks/"
          onClick={(event) => {
            event.preventDefault()
            resetFilters()
          }}
          className="rounded border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Reset
        </a>
        <button
          type="button"
          onClick={() => void copyViewLink()}
          className="rounded border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          {copied ? "Copied" : "Copy view"}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading tasks…</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Showing {filtered.length} of {tasks.length} tasks
          </p>
          <div className="space-y-3 md:hidden">
            {sorted.length === 0 ? (
              <div className="rounded-lg border border-border bg-card py-12 text-center text-sm text-muted-foreground">
                No tasks match your filters.
              </div>
            ) : (
              groups.map((g) => (
                <section key={g.key} className="space-y-3">
                  {group === "initiative" && (
                    <GroupHeading group={g} collapsed={!!collapsed[g.key]} onToggle={() => toggleGroup(g.key)} />
                  )}
                  {!collapsed[g.key] && g.tasks.map((task) => {
                const relationSignals = getTaskRelationSignals(task)
                return (
                  <article
                    key={task.id}
                    className="rounded-lg border border-border bg-card p-4"
                  >
                    <a
                      href={`/tasks/${task.id}/`}
                      className="block text-sm font-semibold text-foreground"
                    >
                      {task.title}
                    </a>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PriorityBadge priority={task.priority} />
                      <StatusSelect key={`${task.id}:${task.status}`} taskId={task.id} status={task.status} />
                      <DueBadge task={task} />
                      {relationSignals.hasBlockedBy && (
                        <span className="rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          Blocked by {relationSignals.blockedBy.length}
                        </span>
                      )}
                      {relationSignals.hasBlockers && (
                        <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Blocks {relationSignals.blockers.length}
                        </span>
                      )}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Owner</dt>
                        <dd className="font-medium text-foreground">
                          {task.owner ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Iteration</dt>
                        <dd className="font-medium text-foreground">
                          {task.iteration ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 border-t border-border pt-3">
                      <TaskActions taskId={task.id} status={task.status} />
                    </div>
                  </article>
                )
              })}
                </section>
              ))
            )}
          </div>
          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-background">
                  <th className="w-[40%] px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Title"
                      sortValue="title_asc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Priority"
                      sortValue="priority_asc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Status"
                      sortValue="status_asc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Owner"
                      sortValue="owner_asc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Iteration"
                      sortValue="iteration_desc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    <SortHeader
                      label="Due"
                      sortValue="due_asc"
                      activeSort={sort}
                      setSort={updateSort}
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Signals
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-16 text-center text-muted-foreground"
                    >
                      No tasks match your filters.
                    </td>
                  </tr>
                ) : (
                  groups.flatMap((g) => [
                    ...(group === "initiative"
                      ? [
                          <tr key={`group:${g.key}`} className="border-b border-border bg-muted/50">
                            <td colSpan={8} className="px-4 py-2">
                              <GroupHeading
                                group={g}
                                collapsed={!!collapsed[g.key]}
                                onToggle={() => toggleGroup(g.key)}
                              />
                            </td>
                          </tr>,
                        ]
                      : []),
                    ...(collapsed[g.key] ? [] : g.tasks).map((task) => {
                    const relationSignals = getTaskRelationSignals(task)
                    return (
                      <tr
                        key={task.id}
                        className="border-b border-border hover:bg-muted"
                      >
                        <td className={`max-w-[420px] py-3 pr-4 ${group === "initiative" ? "pl-8" : "pl-4"}`}>
                          <a
                            href={`/tasks/${task.id}/`}
                            className="block leading-snug font-medium text-foreground hover:underline"
                            title={task.title}
                          >
                            {task.title}
                          </a>
                        </td>
                        <td className="px-4 py-3">
                          <PriorityBadge priority={task.priority} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusSelect key={`${task.id}:${task.status}`} taskId={task.id} status={task.status} />
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {task.owner ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {task.iteration ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <DueBadge task={task} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {relationSignals.hasBlockedBy && (
                              <span className="text-xs font-medium text-red-700">
                                Blocked by {relationSignals.blockedBy.length}
                              </span>
                            )}
                            {relationSignals.hasBlockers && (
                              <span className="text-xs font-medium text-amber-700">
                                Blocks {relationSignals.blockers.length}
                              </span>
                            )}
                            {!relationSignals.hasBlockedBy &&
                              !relationSignals.hasBlockers && (
                                <span className="text-xs text-muted-foreground">
                                  —
                                </span>
                              )}
                          </div>
                        </td>
                        <td className="min-w-[220px] px-4 py-3">
                          <TaskActions taskId={task.id} status={task.status} />
                        </td>
                      </tr>
                    )
                  }),
                  ])
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
