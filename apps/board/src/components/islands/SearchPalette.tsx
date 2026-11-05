import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Result = {
  id: string
  type: string
  title: string
  path: string
  status: string | null
  priority: string | null
  owner: string | null
  updated_at: string
}

const TYPE_HREF: Record<string, (id: string) => string> = {
  task: (id) => `/tasks/${id}/`,
  decision: (id) => `/artifacts/${id}/`,
  initiative: (id) => `/artifacts/${id}/`,
  note: (id) => `/artifacts/${id}/`,
  playbook: (id) => `/artifacts/${id}/`,
  meeting: (id) => `/artifacts/${id}/`,
}

function hrefFor(r: Result): string {
  const fn = TYPE_HREF[r.type] ?? ((id: string) => `/artifacts/${id}/`)
  return fn(r.id)
}

export default function SearchPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Cmd/Ctrl+K to toggle — listen on the parent AND on every same-origin
  // iframe (the terminal pane captures focus and otherwise eats the
  // shortcut). Re-bind whenever new iframes appear. Also listens for
  // a "hey:open-search" custom event so any UI element (e.g. the
  // sidebar search button) can trigger the palette without faking a
  // keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        e.stopPropagation()
        setOpen((o) => !o)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    const onOpenEvent = () => setOpen(true)
    window.addEventListener("keydown", onKey)
    window.addEventListener("hey:open-search", onOpenEvent)
    const bindFrame = (frame: HTMLIFrameElement) => {
      try {
        frame.contentWindow?.addEventListener("keydown", onKey)
      } catch {
        /* cross-origin or not ready */
      }
    }
    const bindAll = () => document.querySelectorAll("iframe").forEach(bindFrame)
    bindAll()
    // Rebind on iframe load (each navigation reloads the terminal iframe).
    const onLoad = (ev: Event) => {
      const t = ev.target as HTMLElement | null
      if (t && t.tagName === "IFRAME") bindFrame(t as HTMLIFrameElement)
    }
    document.addEventListener("load", onLoad, true)
    // Also rebind on astro:page-load (after view-transition swap settles).
    document.addEventListener("astro:page-load", bindAll)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("hey:open-search", onOpenEvent)
      document.removeEventListener("load", onLoad, true)
      document.removeEventListener("astro:page-load", bindAll)
      document.querySelectorAll("iframe").forEach((f) => {
        try {
          f.contentWindow?.removeEventListener("keydown", onKey)
        } catch {
          /* best-effort */
        }
      })
    }
  }, [open])

  // Focus input when opening; reset state when closing.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10)
    } else {
      setQuery("")
      setResults([])
      setActive(0)
      abortRef.current?.abort()
    }
  }, [open])

  // Debounced fetch.
  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (!trimmed) {
      setResults([])
      setLoading(false)
      return
    }
    const id = window.setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const res = await fetch(
          `/search?q=${encodeURIComponent(trimmed)}&limit=30`,
          { signal: ctrl.signal }
        )
        const json = (await res.json()) as { ok: boolean; results?: Result[] }
        if (json.ok && json.results) {
          setResults(json.results)
          setActive(0)
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          console.error("[search]", err)
        }
      } finally {
        setLoading(false)
      }
    }, 120)
    return () => window.clearTimeout(id)
  }, [query, open])

  const navigate = useCallback((r: Result) => {
    setOpen(false)
    window.location.href = hrefFor(r)
  }, [])

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActive((a) => Math.min(results.length - 1, a + 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActive((a) => Math.max(0, a - 1))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const r = results[active]
        if (r) navigate(r)
      }
    },
    [results, active, navigate]
  )

  const empty = useMemo(
    () => !loading && query.trim() && results.length === 0,
    [loading, query, results]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search tasks, decisions, notes, playbooks, meetings…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {loading
                ? "Searching…"
                : empty
                  ? `No results for "${query.trim()}"`
                  : "Start typing to search"}
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left transition-colors last:border-b-0 ${
                i === active
                  ? "bg-accent text-foreground"
                  : "text-foreground hover:bg-accent/50"
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <TypeBadge type={r.type} />
                <span className="flex-1 truncate font-medium">{r.title}</span>
                {r.priority && (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {r.priority}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="truncate font-mono">{r.id}</span>
                {r.owner && <span>· {r.owner}</span>}
                {r.status && <span>· {r.status}</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="border-t border-border bg-card/40 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">↑↓</span> navigate
          <span className="mx-2">·</span>
          <span className="font-mono">enter</span> open
          <span className="mx-2">·</span>
          <span className="font-mono">esc</span> close
          <span className="float-right font-mono">⌘K</span>
        </div>
      </div>
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {type}
    </span>
  )
}
