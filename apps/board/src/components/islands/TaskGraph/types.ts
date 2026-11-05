export interface GraphNode {
  id: string
  title: string
  type: string
  status: string | null
  priority: "do" | "plan" | "routine" | "drop" | null
  owner: string | null
  iteration: string | null
  area: string | null
}

export interface GraphEdge {
  source: string
  target: string
  type: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type ColorBy = "priority" | "owner" | "area" | "iteration"

export interface FilterState {
  owners: string[]
  areas: string[]
  iterations: string[]
}

export type StyleRule = { selector: string; style: Record<string, unknown> }
