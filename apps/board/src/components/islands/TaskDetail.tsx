import { useCallback, useEffect, useMemo, useState } from "react"
import { marked } from "marked"
import type { SerializedTask } from "@/lib/types"
import TaskActions from "@/components/islands/TaskActions"

const MD_VIEW_KEY = "hey-md-view:task"

// Node 25 (and Node 22 launched with --localstorage-file) expose a partial
// localStorage during SSR — `typeof localStorage === "undefined"` is not a
// sufficient guard. Mirror RightPane / InboxBody.
function hasLocalStorage(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.localStorage?.getItem === "function"
    )
  } catch {
    return false
  }
}

function readMdMode(): "pretty" | "raw" {
  if (!hasLocalStorage()) return "pretty"
  return window.localStorage.getItem(MD_VIEW_KEY) === "raw" ? "raw" : "pretty"
}

interface Source {
  url?: string
  kind?: string
  ref?: string
  title?: string
}

interface Props {
  initialTask: SerializedTask
  createdAt: string
  body: string
  absolutePath: string
  sources: Source[]
}

const PRIORITY_COLORS: Record<string, string> = {
  do: "bg-red-100 text-red-800",
  plan: "bg-blue-100 text-blue-800",
  routine: "bg-amber-100 text-amber-800",
  drop: "bg-muted text-muted-foreground",
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  in_progress: "bg-sky-100 text-sky-800",
  plan: "bg-violet-100 text-violet-800",
  blocked: "bg-red-100 text-red-800",
  done: "bg-muted text-muted-foreground",
  archived: "bg-background text-muted-foreground",
  cancelled: "bg-background text-muted-foreground line-through",
}

const STATUS_LABELS: Record<string, string> = {
  plan: "Planned",
  active: "Ready",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  archived: "Archived",
  cancelled: "Cancelled",
}

function PriorityBadge({
  priority,
}: {
  priority: SerializedTask["priority"]
}) {
  const classes = priority
    ? (PRIORITY_COLORS[priority] ?? "bg-background text-muted-foreground")
    : "bg-background text-muted-foreground"

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {priority ?? "-"}
    </span>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const classes = status
    ? (STATUS_COLORS[status] ?? "bg-muted text-muted-foreground")
    : "bg-background text-muted-foreground"
  const label = status ? (STATUS_LABELS[status] ?? status) : "-"

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  )
}

function display(value: string | null | undefined): string {
  return value && value.length > 0 ? value : "-"
}

function artifactHref(id: string): string {
  return id.startsWith("task_") ? `/tasks/${id}/` : `/artifacts/${id}/`
}

export default function TaskDetail({
  initialTask,
  createdAt,
  body,
  absolutePath,
  sources,
}: Props) {
  const [task, setTask] = useState(initialTask)

  const refreshTask = useCallback(async () => {
    try {
      const res = await fetch(`/tasks/data.json?t=${Date.now()}`, {
        cache: "no-store",
      })
      if (!res.ok) return
      const tasks = (await res.json()) as SerializedTask[]
      const nextTask = tasks.find((item) => item.id === initialTask.id)
      if (nextTask) setTask(nextTask)
    } catch {
      // Keep the current rendered task if the live index is temporarily unavailable.
    }
  }, [initialTask.id])

  useEffect(() => {
    queueMicrotask(() => {
      void refreshTask()
    })
  }, [refreshTask])

  useEffect(() => {
    function handleActionComplete(event: Event) {
      const detail = (event as CustomEvent).detail as
        | { params?: { task?: string } }
        | undefined
      if (detail?.params?.task === initialTask.id) {
        void refreshTask()
      }
    }

    window.addEventListener("board:action-complete", handleActionComplete)
    return () => {
      window.removeEventListener("board:action-complete", handleActionComplete)
    }
  }, [initialTask.id, refreshTask])

  const fieldRows = [
    ["ID", task.id],
    ["Status", task.status],
    ["Priority", task.priority],
    ["Owner", task.owner],
    ["Iteration", task.iteration],
    ["Area", task.area],
    ["Due", task.due_date],
    ["Created", createdAt],
    ["Updated", task.updated_at],
    ["Path", task.path],
  ]

  return (
    <>
      <header className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
          {task.iteration && (
            <a
              href={`/iterations/${task.iteration}/`}
              className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              {task.iteration}
            </a>
          )}
          <a
            href={task.vscodeHref}
            className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            title={absolutePath}
          >
            VS Code
          </a>
        </div>
        <h1 className="max-w-4xl text-2xl leading-tight font-semibold text-foreground">
          {task.title}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">{task.id}</p>
      </header>

      <section className="mb-8">
        <TaskActions
          taskId={task.id}
          status={task.status}
          className="flex flex-wrap gap-2"
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Frontmatter
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <tbody>
              {fieldRows.map(([label, value]) => (
                <tr
                  key={label}
                  className="border-b border-border last:border-b-0"
                >
                  <th className="w-36 px-4 py-2 text-left font-medium text-muted-foreground">
                    {label}
                  </th>
                  <td className="px-4 py-2 text-foreground">
                    {display(value)}
                  </td>
                </tr>
              ))}
              <tr className="border-b border-border">
                <th className="w-36 px-4 py-2 text-left font-medium text-muted-foreground">
                  Tags
                </th>
                <td className="px-4 py-2 text-foreground">
                  {task.tags.length > 0 ? task.tags.join(", ") : "-"}
                </td>
              </tr>
              <tr className="border-b border-border">
                <th className="w-36 px-4 py-2 text-left align-top font-medium text-muted-foreground">
                  Relations
                </th>
                <td className="px-4 py-2 text-foreground">
                  {task.relations_out.length === 0 ? (
                    "-"
                  ) : (
                    <ul className="space-y-1">
                      {task.relations_out.map((relation) => (
                        <li key={`${relation.type}:${relation.target}`}>
                          <span className="text-muted-foreground">
                            {relation.type}
                          </span>
                          <span className="px-1 text-muted-foreground/60">→</span>
                          <a
                            href={artifactHref(relation.target)}
                            className="font-mono text-xs font-medium hover:underline"
                          >
                            {relation.target}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
              <tr>
                <th className="w-36 px-4 py-2 text-left align-top font-medium text-muted-foreground">
                  Sources
                </th>
                <td className="px-4 py-2 text-foreground">
                  {sources.length === 0 ? (
                    "-"
                  ) : (
                    <ul className="space-y-1">
                      {sources.map((source, index) => (
                        <li key={`${source.url ?? source.title ?? index}`}>
                          {source.url ? (
                            <a
                              href={source.url}
                              className="font-medium hover:underline"
                            >
                              {source.title ?? source.url}
                            </a>
                          ) : (
                            <span>
                              {source.title ??
                                source.ref ??
                                source.kind ??
                                "source"}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <BodySection body={body} />
    </>
  )
}

function BodySection({ body }: { body: string }) {
  const [mode, setMode] = useState<"pretty" | "raw">(readMdMode)
  const trimmed = body.trim()
  const html = useMemo(
    () => (trimmed ? (marked.parse(trimmed) as string) : ""),
    [trimmed]
  )
  const setAndPersist = useCallback((m: "pretty" | "raw") => {
    setMode(m)
    try {
      localStorage.setItem(MD_VIEW_KEY, m)
    } catch {
      /* best-effort */
    }
  }, [])

  if (!trimmed) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Body
        </h2>
        <p className="rounded-lg border border-border bg-card px-6 py-5 text-sm text-muted-foreground">
          No markdown body.
        </p>
      </section>
    )
  }

  const btnBase =
    "rounded border border-border px-2 py-0.5 transition-colors"
  const btnActive = "bg-foreground text-background border-foreground"
  const btnInactive = "text-muted-foreground hover:text-foreground"

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Body
        </h2>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setAndPersist("pretty")}
            className={`${btnBase} ${mode === "pretty" ? btnActive : btnInactive}`}
          >
            Pretty
          </button>
          <button
            type="button"
            onClick={() => setAndPersist("raw")}
            className={`${btnBase} ${mode === "raw" ? btnActive : btnInactive}`}
          >
            Raw
          </button>
        </div>
      </div>
      {mode === "pretty" ? (
        <article
          className="prose prose-sm dark:prose-invert max-w-none rounded-lg border border-border bg-card px-6 py-5"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto rounded-lg border border-border bg-card p-4 text-sm leading-6 whitespace-pre-wrap text-foreground">
          {body}
        </pre>
      )}
    </section>
  )
}
