import { useState } from "react"

// Status picker for a task row. Posts to /api/task/status (./hey task status),
// which rewrites the frontmatter, logs the change under ## Agent Log and
// commits it; listeners of board:action-complete then refresh their data.

const STATUS_OPTIONS = [
  "plan",
  "ready",
  "doing",
  "blocked",
  "done",
  "archived",
  "cancelled",
] as const

const STATUS_LABELS: Record<string, string> = {
  plan: "Planned",
  ready: "Ready",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
  cancelled: "Cancelled",
}

const STATUS_COLORS: Record<string, string> = {
  plan: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  ready: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  doing: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  blocked: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  done: "bg-muted text-muted-foreground",
  archived: "bg-background text-muted-foreground",
  cancelled: "bg-background text-muted-foreground line-through",
}

interface Props {
  taskId: string
  status: string | null | undefined
}

export default function StatusSelect({ taskId, status }: Props) {
  const [value, setValue] = useState(status ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: string) {
    if (!next || next === value) return
    const previous = value
    setValue(next)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/task/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: taskId, status: next }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setValue(previous)
        setError(
          res.status >= 500 && !data.error
            ? "API not running (apps/api, port 4317)"
            : (data.error ?? `HTTP ${res.status}`)
        )
        return
      }
      window.dispatchEvent(
        new CustomEvent("board:action-complete", {
          detail: {
            endpoint: "/api/task/status",
            params: { task: taskId, status: next },
            response: data,
          },
        })
      )
    } catch (err) {
      setValue(previous)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const cls = STATUS_COLORS[value] ?? "bg-muted text-muted-foreground"
  return (
    <div className="flex flex-col items-start gap-1">
      <select
        aria-label="Task status"
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className={`cursor-pointer appearance-none rounded border-0 py-0.5 pr-5 pl-2 text-xs font-medium focus:ring-1 focus:ring-ring focus:outline-none disabled:opacity-60 ${cls}`}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath d='M1 3l3 3 3-3' fill='none' stroke='%23888' stroke-width='1.2'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 6px center",
        }}
      >
        {!value && <option value="">—</option>}
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <p className="max-w-[220px] text-xs text-red-600">{error}</p>}
    </div>
  )
}
