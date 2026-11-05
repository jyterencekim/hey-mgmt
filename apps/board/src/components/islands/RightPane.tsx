import { useCallback, useEffect, useRef, useState } from "react"

type TerminalTheme = "dark" | "light"

type Props = {
  member: string
}

const KEY_COLLAPSED = "hey-right-pane-collapsed"
const KEY_WIDTH = "hey-right-pane-width"
const KEY_FONT = "hey-terminal-font-size"
const KEY_THEME = "hey-terminal-theme"

const DEFAULT_WIDTH = 640
const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.6
const DEFAULT_FONT = 14
const MIN_FONT = 11
const MAX_FONT = 22

// xterm.js theme objects injected directly into term.options.theme.
// ttyd does NOT support xterm options via its -t flag (those are
// ttyd's own clientOptions; xterm opts are silently ignored). So we
// inject these into iframe.contentWindow.term.options from the parent
// after ttyd's WS handshake creates the Terminal instance.
const XTERM_THEMES: Record<TerminalTheme, Record<string, string>> = {
  dark: {
    background: "#1c1c1f",
    foreground: "#f4f4f5",
    cursor: "#7170ff",
    cursorAccent: "#1c1c1f",
    selectionBackground: "#7170ff66",
    black: "#1c1c1f",
    red: "#eb5757",
    green: "#26b96b",
    yellow: "#f2c94c",
    blue: "#56ccf2",
    magenta: "#9b51e0",
    cyan: "#56ccf2",
    white: "#c8c8cd",
    brightBlack: "#6c6c73",
    brightRed: "#ff7a7a",
    brightGreen: "#4cd483",
    brightYellow: "#ffd96b",
    brightBlue: "#7fd9ff",
    brightMagenta: "#b87aff",
    brightCyan: "#7fe0ff",
    brightWhite: "#f4f4f5",
  },
  light: {
    background: "#ffffff",
    foreground: "#18181b",
    cursor: "#18181b",
    cursorAccent: "#ffffff",
    selectionBackground: "#0000001a",
    black: "#18181b",
    red: "#b91c1c",
    green: "#15803d",
    yellow: "#a16207",
    blue: "#1d4ed8",
    magenta: "#7e22ce",
    cyan: "#0e7490",
    white: "#52525b",
    brightBlack: "#71717a",
    brightRed: "#dc2626",
    brightGreen: "#16a34a",
    brightYellow: "#ca8a04",
    brightBlue: "#2563eb",
    brightMagenta: "#9333ea",
    brightCyan: "#0891b2",
    brightWhite: "#18181b",
  },
}

// `typeof localStorage === "undefined"` is not enough — Node 22+ with
// experimental webstorage, jsdom, and some Astro SSR setups expose a partial
// `localStorage` global where `.getItem` is not a function. Gate on a real
// window plus a callable getItem instead, and swallow any access throws
// (Safari private mode, disabled storage).
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

function readNum(key: string, fallback: number): number {
  if (!hasLocalStorage()) return fallback
  const raw = window.localStorage.getItem(key)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function readCollapsed(): boolean {
  if (!hasLocalStorage()) return true
  return window.localStorage.getItem(KEY_COLLAPSED) !== "false"
}

function readTheme(): TerminalTheme {
  if (!hasLocalStorage()) return "dark"
  return window.localStorage.getItem(KEY_THEME) === "light" ? "light" : "dark"
}

function clampWidth(w: number): number {
  if (typeof window === "undefined") return Math.max(MIN_WIDTH, w)
  const max = Math.floor(window.innerWidth * MAX_WIDTH_RATIO)
  return Math.max(MIN_WIDTH, Math.min(max, w))
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* best-effort */
  }
}

type TermLike = {
  options: Record<string, unknown>
  refresh?: (s: number, e: number) => void
  rows?: number
  fit?: () => void
}

// Walk the iframe's window for an xterm.js Terminal instance with .options.
// ttyd assigns the Terminal to `window.term` after the WS handshake; that
// can take 100-300 ms after the iframe's load event fires.
function getTerm(iframe: HTMLIFrameElement | null): TermLike | null {
  if (!iframe) return null
  try {
    const win = iframe.contentWindow as unknown as { term?: unknown }
    const term = win?.term as TermLike | undefined
    if (term && term.options && typeof term.options === "object") return term
  } catch {
    /* not yet, or cross-origin */
  }
  return null
}

function refreshTerm(iframe: HTMLIFrameElement | null): void {
  const term = getTerm(iframe)
  if (!term) return
  try {
    // fit() recalculates rows/cols from the iframe container and triggers a
    // full canvas reflow — more robust than refresh() alone when the WebGL
    // renderer has lost context due to a view-transition reflow.
    if (typeof term.fit === "function") term.fit()
    if (typeof term.refresh === "function") {
      const rows = typeof term.rows === "number" ? term.rows : 24
      term.refresh(0, Math.max(0, rows - 1))
    }
  } catch {
    /* best-effort — renderer may be transiently bad */
  }
}

export default function RightPane({ member }: Props) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  const [width, setWidth] = useState<number>(() =>
    clampWidth(readNum(KEY_WIDTH, DEFAULT_WIDTH))
  )
  const [fontSize, setFontSize] = useState<number>(() =>
    Math.min(MAX_FONT, Math.max(MIN_FONT, readNum(KEY_FONT, DEFAULT_FONT)))
  )
  const [terminalTheme, setTerminalTheme] = useState<TerminalTheme>(readTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [termReady, setTermReady] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    persist(KEY_COLLAPSED, String(collapsed))
  }, [collapsed])
  useEffect(() => {
    persist(KEY_WIDTH, String(width))
  }, [width])
  useEffect(() => {
    persist(KEY_FONT, String(fontSize))
  }, [fontSize])
  useEffect(() => {
    persist(KEY_THEME, terminalTheme)
  }, [terminalTheme])

  // Re-clamp width if the window resizes smaller than the persisted width.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w))
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // Apply xterm options (fontSize / theme) directly to the Terminal instance.
  // Used by both the post-iframe-load poll and the live settings change effect.
  const applyOptions = useCallback(() => {
    const term = getTerm(iframeRef.current)
    if (!term) return false
    term.options.fontSize = fontSize
    term.options.theme = XTERM_THEMES[terminalTheme]
    return true
  }, [fontSize, terminalTheme])

  // After the iframe (re)loads, poll for the Terminal to be created.
  // xterm.js Terminal is constructed when ttyd's JS receives the WS
  // handshake, which is ~100-300ms after the iframe's load event.
  const onIframeLoad = useCallback(() => {
    setTermReady(false)
    let tries = 0
    const id = window.setInterval(() => {
      tries += 1
      if (applyOptions()) {
        setTermReady(true)
        window.clearInterval(id)
      }
      if (tries > 100) window.clearInterval(id) // give up after ~5s
    }, 50)
  }, [applyOptions])

  // Live updates: when fontSize / theme change in settings, apply
  // directly to the running Terminal — no iframe reload, no ttyd
  // respawn, no flicker.
  useEffect(() => {
    if (!termReady) return
    applyOptions()
    // Force a redraw — option changes don't always trigger one in
    // xterm.js v5 (theme does, fontSize doesn't reliably).
    refreshTerm(iframeRef.current)
  }, [termReady, fontSize, terminalTheme, applyOptions])

  // Astro's ClientRouter swaps the surrounding DOM on navigation. The iframe
  // itself survives via transition:persist, but xterm.js's WebGL renderer
  // sometimes stops painting after the reflow until it gets a fit + refresh
  // kick. We fire several at staggered delays — pages with heavy React
  // islands (TaskFilter on /tasks/) steal the main thread during hydration,
  // so the earlier kicks can be no-ops and the late ones catch up.
  useEffect(() => {
    const kick = () => {
      const iframe = iframeRef.current
      requestAnimationFrame(() => refreshTerm(iframe))
      window.setTimeout(() => refreshTerm(iframe), 60)
      window.setTimeout(() => refreshTerm(iframe), 250)
      window.setTimeout(() => refreshTerm(iframe), 800)
    }
    document.addEventListener("astro:after-swap", kick)
    document.addEventListener("astro:page-load", kick)
    return () => {
      document.removeEventListener("astro:after-swap", kick)
      document.removeEventListener("astro:page-load", kick)
    }
  }, [])

  // Watch the iframe's container for size changes. If the right pane resizes
  // (drag handle) OR the layout reflows during a view transition, fit the
  // terminal to match. This is the most reliable recovery for the /tasks/
  // case where the staggered kicks above can all fire while the heavy
  // island is still hydrating.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => refreshTerm(iframe))
    ro.observe(iframe)
    return () => ro.disconnect()
  }, [])

  // Drag-to-resize on the left edge of the expanded pane.
  // Uses pointer-capture so events keep flowing to the handle even when the
  // pointer leaves the window — without capture, a release-outside-window
  // skips pointerup entirely and the resize "sticks" (subsequent stray
  // mousemoves keep resizing). Updates are throttled to rAF to keep the
  // setState -> style -> ResizeObserver -> fit() -> PTY-resize cascade
  // from saturating the main thread.
  const startResize = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const handle = e.currentTarget
      const pointerId = e.pointerId
      const startX = e.clientX
      const startWidth = width
      let pendingWidth = startWidth
      let rafScheduled = false
      setResizing(true)
      handle.setPointerCapture(pointerId)
      const flush = () => {
        rafScheduled = false
        setWidth(pendingWidth)
      }
      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        pendingWidth = clampWidth(startWidth + (startX - ev.clientX))
        if (!rafScheduled) {
          rafScheduled = true
          requestAnimationFrame(flush)
        }
      }
      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        setResizing(false)
        try {
          handle.releasePointerCapture(pointerId)
        } catch {
          /* already released */
        }
        handle.removeEventListener("pointermove", onMove)
        handle.removeEventListener("pointerup", onEnd)
        handle.removeEventListener("pointercancel", onEnd)
        handle.removeEventListener("lostpointercapture", onEnd)
        document.body.style.removeProperty("user-select")
        document.body.style.removeProperty("cursor")
        setWidth(pendingWidth)
      }
      handle.addEventListener("pointermove", onMove)
      handle.addEventListener("pointerup", onEnd)
      handle.addEventListener("pointercancel", onEnd)
      handle.addEventListener("lostpointercapture", onEnd)
      document.body.style.userSelect = "none"
      document.body.style.cursor = "col-resize"
    },
    [width]
  )

  // Close settings popover on outside click.
  const settingsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const onClick = (ev: MouseEvent) => {
      if (!settingsRef.current) return
      if (!settingsRef.current.contains(ev.target as Node)) {
        setSettingsOpen(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [settingsOpen])

  if (collapsed) {
    return (
      <aside className="flex h-screen w-9 flex-col items-center border-l border-border bg-card py-2">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Open terminal"
          title="Open terminal"
          className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Chevron direction="left" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="relative flex h-screen flex-col border-l border-border bg-card"
      style={{ width: `${width}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize terminal pane"
        onPointerDown={startResize}
        className={`absolute inset-y-0 left-0 z-20 w-1.5 touch-none cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 ${resizing ? "bg-primary/60" : ""}`}
      />

      <div className="flex items-center justify-between border-b border-border pl-3 pr-2 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Terminal</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            cc-{member}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Terminal settings"
            title="Terminal settings"
            aria-expanded={settingsOpen}
            className={`inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${settingsOpen ? "bg-accent text-foreground" : ""}`}
          >
            <GearIcon />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse terminal"
            title="Collapse terminal"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Chevron direction="right" />
          </button>
        </div>
      </div>

      {settingsOpen && (
        <div
          ref={settingsRef}
          className="absolute right-2 top-12 z-30 w-64 rounded-md border border-border bg-popover p-3 text-sm shadow-lg"
        >
          <div className="mb-3">
            <label
              htmlFor="terminal-font-size"
              className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground"
            >
              <span>Font size</span>
              <span className="font-mono text-foreground">{fontSize}px</span>
            </label>
            <input
              id="terminal-font-size"
              type="range"
              min={MIN_FONT}
              max={MAX_FONT}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <div className="mb-1">
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Terminal theme
            </div>
            <div className="grid grid-cols-2 gap-1">
              <ThemeOption
                value="dark"
                active={terminalTheme === "dark"}
                onSelect={() => setTerminalTheme("dark")}
              />
              <ThemeOption
                value="light"
                active={terminalTheme === "light"}
                onSelect={() => setTerminalTheme("light")}
              />
            </div>
          </div>
        </div>
      )}

      <iframe
        ref={iframeRef}
        src={`/terminal/${encodeURIComponent(member)}/`}
        onLoad={onIframeLoad}
        title={`claude — ${member}`}
        // Background matches the chosen terminal theme so the brief flash
        // during nav-reload (Astro+iframe limit, see main.astro comment)
        // looks like an empty terminal, not a black void.
        className="h-full w-full flex-1 border-0"
        style={{
          backgroundColor: terminalTheme === "light" ? "#ffffff" : "#1c1c1f",
        }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer"
      />
    </aside>
  )
}

function ThemeOption({
  value,
  active,
  onSelect,
}: {
  value: TerminalTheme
  active: boolean
  onSelect: () => void
}) {
  const label = value === "dark" ? "Dark" : "Light"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded border px-2 py-1.5 text-xs transition-colors ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
