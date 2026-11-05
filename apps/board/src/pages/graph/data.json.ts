import { readFileSync } from "node:fs"
import { loadAll } from "@/lib/manifest"
import type { ManifestEntry } from "@/lib/types"

interface GraphNode {
  id: string
  title: string
  type: string
  status: string | null
  priority: "do" | "plan" | "routine" | "drop" | null
  owner: string | null
  iteration: string | null
  area: string | null
}

interface GraphEdge {
  source: string
  target: string
  type: string
}

const PROJECTION_TYPES = new Set(["task", "initiative", "decision", "note", "meeting", "playbook", "goal"])

/**
 * When KG_GRAPH_JSONL points at hey-mgmt-intelligence's build/graph.jsonl, render
 * every mgmt artifact type and every authored edge from the projection instead of
 * the task/initiative subset. Default behaviour is unchanged.
 */
function fromProjection(path: string): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean)
    const nodes: GraphNode[] = []
    const known = new Set<string>()
    const edges: GraphEdge[] = []
    for (const line of lines) {
      const r = JSON.parse(line)
      if (r.record === "node" && r.ns === "mgmt" && PROJECTION_TYPES.has(r.kind)) {
        const id = String(r.id).slice("mgmt:".length)
        known.add(id)
        nodes.push({ id, title: r.title, type: r.kind, status: r.status ?? null, priority: r.meta?.priority ?? null, owner: r.owner ?? null, iteration: r.meta?.iteration ?? null, area: r.meta?.area ?? null })
      }
    }
    for (const line of lines) {
      const r = JSON.parse(line)
      if (r.record !== "edge" || r.derived) continue
      const s = String(r.src), t = String(r.dst)
      if (!s.startsWith("mgmt:") || !t.startsWith("mgmt:")) continue
      const source = s.slice(5), target = t.slice(5)
      if (known.has(source) && known.has(target)) edges.push({ source, target, type: r.rel })
    }
    return { nodes, edges }
  } catch {
    return null
  }
}

export async function GET() {
  const projection = process.env.KG_GRAPH_JSONL ? fromProjection(process.env.KG_GRAPH_JSONL) : null
  if (projection) {
    return new Response(JSON.stringify(projection), { headers: { "Content-Type": "application/json" } })
  }
  const entries = loadAll()
  const known = new Set(entries.map((e) => e.id))

  const nodes: GraphNode[] = entries
    .filter((e) => e.type === "task" || e.type === "initiative")
    .map((e: ManifestEntry) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      priority: e.priority,
      owner: e.owner,
      iteration: e.iteration,
      area: e.area,
    }))

  const edges: GraphEdge[] = []
  for (const entry of entries) {
    if (entry.type !== "task" && entry.type !== "initiative") continue
    for (const relation of entry.relations_out ?? []) {
      if (!known.has(relation.target)) continue
      edges.push({
        source: entry.id,
        target: relation.target,
        type: relation.type,
      })
    }
  }

  return new Response(JSON.stringify({ nodes, edges }), {
    headers: { "Content-Type": "application/json" },
  })
}
