import { useCallback, useMemo, useState } from "react"
import { marked } from "marked"

const MD_VIEW_KEY = "hey-md-view:inbox"

// Node 25 (and Node 22 launched with --localstorage-file) expose a partial
// localStorage during SSR — `typeof localStorage === "undefined"` is not a
// sufficient guard. Mirror the helper used by RightPane.
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

interface Props {
  body: string
}

export default function InboxBody({ body }: Props) {
  const [mode, setMode] = useState<"pretty" | "raw">(readMdMode)
  const trimmed = body.trim()
  const html = useMemo(
    () => (trimmed ? (marked.parse(trimmed) as string) : ""),
    [trimmed]
  )
  const setAndPersist = useCallback((m: "pretty" | "raw") => {
    setMode(m)
    try {
      window.localStorage.setItem(MD_VIEW_KEY, m)
    } catch {
      /* best-effort */
    }
  }, [])

  if (!trimmed) {
    return (
      <p className="rounded-lg border border-border bg-card px-6 py-5 text-sm text-muted-foreground">
        No body.
      </p>
    )
  }

  const btnBase = "rounded border border-border px-2 py-0.5 transition-colors"
  const btnActive = "bg-foreground text-background border-foreground"
  const btnInactive = "text-muted-foreground hover:text-foreground"

  return (
    <>
      <div className="mb-3 flex items-center justify-end gap-1 text-xs">
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
    </>
  )
}
