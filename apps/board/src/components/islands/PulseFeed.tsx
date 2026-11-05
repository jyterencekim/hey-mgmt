import { useEffect, useMemo, useRef, useState } from "react"

// Last-24h activity, grouped by member. The api's /pulse-stream replays the
// last day of commits touching content/ or workspace/ and pushes new ones
// every 10s; each event already carries the member its git author maps to,
// a bot flag, and the files it changed (with frontmatter titles).

type PulseFile = { path: string; id: string; title: string | null }

type PulseEvent = {
  id: string
  ts: string
  actor: string
  member: string | null
  bot: boolean
  subject: string
  files: PulseFile[]
}

type Group = {
  key: string
  label: string
  member: string | null
  events: PulseEvent[]
  files: (PulseFile & { ts: string })[] // titled artifacts, newest first
  otherFiles: number // untitled files (inbox JSON, logs, slide assets)
}

const WINDOW_MS = 24 * 60 * 60 * 1000
const FILES_SHOWN = 6

function relTime(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ""
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return `${Math.max(0, Math.floor(diff))}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const ACTOR_COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-rose-600",
  "bg-amber-600",
  "bg-teal-600",
  "bg-indigo-600",
  "bg-orange-600",
]

function colorFor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0
  return ACTOR_COLORS[Math.abs(h) % ACTOR_COLORS.length]
}

function cleanSubject(subject: string): string {
  return subject.replace(/^[a-z-]+:\s*/i, "")
}

// Only files with a frontmatter title are artifacts worth listing by name;
// inbox JSON, logs and slide assets are counted, not listed.
function buildGroup(key: string, label: string, member: string | null, events: PulseEvent[]): Group {
  const seen = new Map<string, PulseFile & { ts: string }>()
  const other = new Set<string>()
  for (const e of events) {
    for (const f of e.files) {
      if (!f.title) other.add(f.path)
      else if (!seen.has(f.path)) seen.set(f.path, { ...f, ts: e.ts })
    }
  }
  return { key, label, member, events, files: [...seen.values()], otherFiles: other.size }
}

function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
        muted ? "bg-muted-foreground/40" : colorFor(name)
      }`}
      aria-hidden="true"
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  )
}

function FileLink({ f }: { f: PulseFile & { ts: string } }) {
  return (
    <li className="flex items-baseline gap-2">
      <a
        href={`/artifacts/${f.id}/`}
        className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
        title={f.title ?? f.id}
      >
        {f.title}
      </a>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{relTime(f.ts)}</span>
    </li>
  )
}

function CommitList({ events }: { events: PulseEvent[] }) {
  return (
    <ol className="mt-2 space-y-1 border-l border-border pl-3">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={e.subject}>
            {cleanSubject(e.subject)}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">{relTime(e.ts)}</span>
        </li>
      ))}
    </ol>
  )
}

function MemberCard({ group, isMe }: { group: Group; isMe: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const latest = group.events[0]
  const files = showAll ? group.files : group.files.slice(0, FILES_SHOWN)
  const idle = group.events.length === 0
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-card p-4 ${idle ? "opacity-70" : ""}`}>
      <header className="flex items-center gap-2.5">
        <Avatar name={group.label} muted={idle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {group.member ? (
              <a href={`/me/${group.member}/`} className="text-sm font-semibold text-foreground hover:underline">
                {group.label}
              </a>
            ) : (
              <span className="text-sm font-semibold text-foreground">{group.label}</span>
            )}
            {isMe && <span className="text-[11px] text-muted-foreground">you</span>}
          </div>
          <div className="text-xs text-muted-foreground">
            {idle
              ? "No changes in the last 24h"
              : `${group.events.length} commits · ${group.files.length} docs · last ${relTime(latest.ts)}`}
          </div>
        </div>
      </header>

      {group.files.length > 0 && (
        <ul className="mt-3 space-y-1">
          {files.map((f) => (
            <FileLink key={f.path} f={f} />
          ))}
        </ul>
      )}
      {(group.files.length > FILES_SHOWN || group.otherFiles > 0) && (
        <div className="mt-1.5 flex items-baseline gap-3 text-xs text-muted-foreground">
          {group.files.length > FILES_SHOWN && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="hover:text-foreground">
              {showAll ? "Show fewer" : `+${group.files.length - FILES_SHOWN} more docs`}
            </button>
          )}
          {group.otherFiles > 0 && <span>{group.otherFiles} other files</span>}
        </div>
      )}
      {!idle && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Commits ({group.events.length})
          </summary>
          <CommitList events={group.events} />
        </details>
      )}
    </section>
  )
}

interface Props {
  coreTeam: string[]
  currentMember: string
}

export default function PulseFeed({ coreTeam, currentMember }: Props) {
  const [events, setEvents] = useState<PulseEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const seenIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const es = new EventSource("/pulse-stream")
    es.addEventListener("backlog", (ev) => {
      try {
        const { events: list } = JSON.parse((ev as MessageEvent).data) as {
          events: PulseEvent[]
        }
        seenIds.current = new Set(list.map((e) => e.id))
        setEvents(list)
        setConnected(true)
        setError(null)
      } catch (e) {
        console.error("[pulse] backlog parse", e)
      }
    })
    es.addEventListener("events", (ev) => {
      try {
        const { events: list } = JSON.parse((ev as MessageEvent).data) as {
          events: PulseEvent[]
        }
        const fresh = list.filter((e) => !seenIds.current.has(e.id))
        if (fresh.length === 0) return
        for (const e of fresh) seenIds.current.add(e.id)
        setEvents((prev) => [...fresh, ...prev])
      } catch (e) {
        console.error("[pulse] events parse", e)
      }
    })
    es.onerror = () => {
      setConnected(false)
      setError("API not reachable (apps/api, port 4317). Retrying…")
    }
    es.onopen = () => {
      setConnected(true)
      setError(null)
    }
    return () => es.close()
  }, [])

  // Tick relative times and slide the 24h window once per minute.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  const { team, others, bots, total } = useMemo(() => {
    const recent = events.filter((e) => now - new Date(e.ts).getTime() < WINDOW_MS)
    const byMember = new Map<string, PulseEvent[]>()
    const byActor = new Map<string, PulseEvent[]>()
    const botEvents: PulseEvent[] = []
    for (const e of recent) {
      if (e.bot) botEvents.push(e)
      else if (e.member && coreTeam.includes(e.member)) {
        byMember.set(e.member, [...(byMember.get(e.member) ?? []), e])
      } else {
        const key = e.member ?? e.actor
        byActor.set(key, [...(byActor.get(key) ?? []), e])
      }
    }
    // Most recently active first; idle members sink to the bottom.
    const lastTs = (g: Group) => g.events[0]?.ts ?? ""
    const team = coreTeam
      .map((m) => buildGroup(m, m, m, byMember.get(m) ?? []))
      .sort((a, b) => lastTs(b).localeCompare(lastTs(a)))
    const others = [...byActor.entries()]
      .map(([k, evs]) => buildGroup(k, k, evs[0].member, evs))
      .sort((a, b) => lastTs(b).localeCompare(lastTs(a)))
    return { team, others, bots: buildGroup("bots", "Automated", null, botEvents), total: recent.length }
  }, [events, now, coreTeam])

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
        />
        <span>{connected ? "Live" : "Connecting…"}</span>
        {error && <span className="text-amber-500">· {error}</span>}
        <span className="ml-auto font-mono">{total} commits in 24h</span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {team.map((g) => (
          <MemberCard key={g.key} group={g} isMe={g.member === currentMember} />
        ))}
      </div>

      {others.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Others
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {others.map((g) => (
              <MemberCard key={g.key} group={g} isMe={false} />
            ))}
          </div>
        </>
      )}

      {bots.events.length > 0 && (
        <details className="mt-6 rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            Automated commits (Fisher) · {bots.events.length} · {bots.files.length} docs
          </summary>
          <CommitList events={bots.events} />
        </details>
      )}
    </div>
  )
}
