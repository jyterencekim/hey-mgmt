import type { ManifestEntry } from "@/lib/types"

// Docs tree for the board, laid out like the Space mirror
// (playbook_codex-space-mirror "Placement"): one physical parent per document,
// a few meaningful levels (section → subject or period → document), and no
// year/month levels for small collections. Tasks live in the Tasks views, so
// they appear here only as child pages of their initiative.

export interface DocFolder {
  key: string // "note/legal/2026/10"; the section key is the type ("note")
  label: string
  children: DocFolder[]
  docs: ManifestEntry[] // direct docs only
  total: number // docs in this folder and every subfolder
}

export const DOC_SECTIONS = [
  { key: "goal", label: "Goals" },
  { key: "initiative", label: "Initiatives" },
  { key: "decision", label: "Decisions" },
  { key: "playbook", label: "Playbooks" },
  { key: "note", label: "Notes" },
  { key: "meeting", label: "Meetings" },
  { key: "report", label: "Reports" },
  { key: "workspace", label: "Workspaces" },
  { key: "other", label: "Attachments" },
] as const

// A folder holding this many docs or fewer shows them in one list instead of
// splitting them into year/month subfolders.
const FLAT_MAX = 40

const CLOSED = new Set(["done", "archived", "cancelled", "superseded"])

const TYPE_DIRS: Record<string, string> = {
  goal: "content/goals",
  initiative: "content/initiatives",
  decision: "content/decisions",
  playbook: "content/playbooks",
  note: "content/notes",
  meeting: "content/meetings",
}

/** Section key and folder segments under it for one document. */
function placement(doc: ManifestEntry): { section: string; segments: string[] } | null {
  if (doc.type === "task") return null
  const dir = doc.path.split("/").slice(0, -1)
  const rel = (prefix: string) => dir.slice(prefix.split("/").length)

  if (doc.path.startsWith("workspace/")) {
    return { section: "workspace", segments: dir.slice(1) }
  }
  if (doc.path.startsWith("content/reports/")) {
    return { section: "report", segments: rel("content/reports") }
  }
  if (doc.type === "initiative") {
    return { section: "initiative", segments: [CLOSED.has(doc.status ?? "") ? "Closed" : "Active"] }
  }
  const typeDir = TYPE_DIRS[doc.type]
  if (typeDir && (doc.path.startsWith(`${typeDir}/`) || dir.join("/") === "content")) {
    return { section: doc.type, segments: doc.path.startsWith(`${typeDir}/`) ? rel(typeDir) : [] }
  }
  return { section: "other", segments: [] }
}

function segmentLabel(segments: string[], i: number): string {
  const seg = segments[i]
  // "2026" / "10" → the month folder reads "2026-10".
  if (/^\d{2}$/.test(seg) && i > 0 && /^\d{4}$/.test(segments[i - 1])) {
    return `${segments[i - 1]}-${seg}`
  }
  return seg
}

function byUpdatedDesc(a: ManifestEntry, b: ManifestEntry): number {
  return (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.title.localeCompare(b.title)
}

function allDocs(folder: DocFolder): ManifestEntry[] {
  return [...folder.docs, ...folder.children.flatMap(allDocs)]
}

function finish(folder: DocFolder, isSection: boolean): void {
  for (const child of folder.children) finish(child, false)
  folder.total = folder.docs.length + folder.children.reduce((n, c) => n + c.total, 0)
  if (!isSection && folder.children.length > 0 && folder.total <= FLAT_MAX) {
    folder.docs = allDocs(folder)
    folder.children = []
  }
  folder.docs.sort(byUpdatedDesc)
  // Named subjects first, then periods newest first; "Active" before "Closed".
  folder.children.sort((a, b) => {
    const ay = /^\d/.test(a.label)
    const by = /^\d/.test(b.label)
    if (ay !== by) return ay ? 1 : -1
    if (ay) return b.label.localeCompare(a.label)
    if (a.label === "Active") return -1
    if (b.label === "Active") return 1
    return a.label.localeCompare(b.label)
  })
}

export function buildDocsTree(entries: ManifestEntry[]): DocFolder[] {
  const roots = new Map<string, DocFolder>()
  for (const s of DOC_SECTIONS) {
    roots.set(s.key, { key: s.key, label: s.label, children: [], docs: [], total: 0 })
  }
  for (const doc of entries) {
    const place = placement(doc)
    if (!place) continue
    let folder = roots.get(place.section)!
    place.segments.forEach((_, i) => {
      const key = `${folder.key}/${place.segments[i]}`
      let next = folder.children.find((c) => c.key === key)
      if (!next) {
        next = { key, label: segmentLabel(place.segments, i), children: [], docs: [], total: 0 }
        folder.children.push(next)
      }
      folder = next
    })
    folder.docs.push(doc)
  }
  const tree = [...roots.values()]
  for (const root of tree) finish(root, true)
  return tree.filter((root) => root.total > 0)
}

/** Every folder in the tree, keyed, with its ancestor chain (root first). */
export function indexDocsTree(tree: DocFolder[]): Map<string, DocFolder[]> {
  const out = new Map<string, DocFolder[]>()
  const walk = (folder: DocFolder, chain: DocFolder[]) => {
    const path = [...chain, folder]
    out.set(folder.key, path)
    folder.children.forEach((c) => walk(c, path))
  }
  tree.forEach((root) => walk(root, []))
  return out
}

/** Folder chain (root first) holding a document, or [] when it is not in the tree. */
export function docLocation(tree: DocFolder[], id: string): DocFolder[] {
  const find = (folder: DocFolder, chain: DocFolder[]): DocFolder[] | null => {
    const path = [...chain, folder]
    if (folder.docs.some((d) => d.id === id)) return path
    for (const c of folder.children) {
      const hit = find(c, path)
      if (hit) return hit
    }
    return null
  }
  for (const root of tree) {
    const hit = find(root, [])
    if (hit) return hit
  }
  return []
}

const STATUS_ORDER: Record<string, number> = {
  doing: 0,
  blocked: 1,
  ready: 2,
  plan: 3,
  active: 4,
  done: 5,
  archived: 6,
  cancelled: 7,
}

/**
 * Child pages of a document from explicit edges: its `parent_of` targets,
 * documents that declare `child_of` it, and for a goal the initiatives that
 * `contributes_to` it. Open work first, then by title.
 */
export function childPages(id: string, entries: ManifestEntry[]): ManifestEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const self = byId.get(id)
  const out = new Map<string, ManifestEntry>()
  for (const r of self?.relations_out ?? []) {
    const target = r.type === "parent_of" ? byId.get(r.target) : undefined
    if (target) out.set(target.id, target)
  }
  for (const e of entries) {
    if (
      e.relations_out.some(
        (r) =>
          r.target === id &&
          (r.type === "child_of" || (self?.type === "goal" && r.type === "contributes_to"))
      )
    ) {
      out.set(e.id, e)
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      (STATUS_ORDER[a.status ?? ""] ?? 9) - (STATUS_ORDER[b.status ?? ""] ?? 9) ||
      a.title.localeCompare(b.title)
  )
}

/** Parent pages a document names explicitly (`child_of`, or a goal it contributes to). */
export function parentPages(doc: ManifestEntry, entries: ManifestEntry[]): ManifestEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const out = new Map<string, ManifestEntry>()
  for (const r of doc.relations_out) {
    if (r.type !== "child_of" && !(doc.type === "initiative" && r.type === "contributes_to")) continue
    const target = byId.get(r.target)
    if (target) out.set(target.id, target)
  }
  for (const e of entries) {
    if (e.relations_out.some((r) => r.type === "parent_of" && r.target === doc.id)) out.set(e.id, e)
  }
  return [...out.values()]
}
