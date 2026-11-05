export type ManifestEntry = {
  id: string
  type: string
  title: string
  path: string
  status: string | null
  priority: "do" | "plan" | "routine" | "drop" | null
  owner: string | null
  due_date: string | null
  timeline_start: string | null
  timeline_end: string | null
  iteration: string | null
  area: string | null
  tags: string[]
  relations_out: { type: string; target: string }[]
  created_at: string
  updated_at: string
  sources: { url?: string; kind?: string; ref?: string; title?: string }[]
  // Product-initiative kickoff contract (decision_adr-product-initiative-kickoff).
  // Emitted by the indexer; optional so older manifests still type-check.
  // Initiative-only:
  initiative_kind?: "product" | "business" | "marketing" | "ops" | null
  prd_doc?: string | null
  components?: string[]
  kickoff_date?: string | null
  baseline_tasks?: string[]
  // Task-only (start/target are the planned schedule; due_date stays the hard
  // external deadline per decision_adr-three-layer-task-timeline):
  component?: string | null
  start_date?: string | null
  target_date?: string | null
}

export type Task = ManifestEntry & { type: "task" }
export type Initiative = ManifestEntry & { type: "initiative" }
export type Goal = ManifestEntry & { type: "goal" }

/**
 * Goal-specific frontmatter fields (target, metric, current, target_date).
 * These live in the artifact markdown frontmatter and are NOT serialized into
 * manifest.jsonl by the indexer (which emits a fixed field set). goalRollups()
 * reads them from disk and attaches them here so pages can render them.
 */
export type GoalDetail = {
  target: string | null
  metric: string | null
  current: string | null
  target_date: string | null
}

/**
 * Trimmed task projection for client-side use (v3/C1).
 * Only these fields are serialized into the TaskFilter island prop.
 */
export type SerializedTask = {
  id: string
  title: string
  status: string | null
  priority: "do" | "plan" | "routine" | "drop" | null
  owner: string | null
  iteration: string | null
  area: string | null
  due_date: string | null
  updated_at: string
  relations_out: { type: string; target: string }[]
  tags: string[]
  path: string
  vscodeHref: string
  // Initiative this task belongs to (child_of / parent_of), when any.
  initiative?: { id: string; title: string } | null
}

export type InboxItem = {
  id: string
  workspace: string
  title: string
  body: string
  source: string
  kind: string
  status: "open" | "read" | "discarded"
  captured_at: string
  updated_at: string
  metadata: Record<string, unknown>
  path: string
  vscodeHref: string
}
