import type { GraphNode } from "./types"
import { PRIORITY_FILL, STATUS_RING, EDGE_TYPE_LABEL } from "./constants"

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  label,
  fill,
  outline,
  text,
}: {
  label: string
  fill: string
  outline?: string
  text?: string
}) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono uppercase tracking-wide"
      style={{
        backgroundColor: fill,
        color: text ?? "#fff",
        boxShadow: outline ? `inset 0 0 0 1px ${outline}` : undefined,
      }}
    >
      {label}
    </span>
  )
}

// ─── NeighborGroup ────────────────────────────────────────────────────────────

function NeighborGroup({
  title,
  items,
  onJumpTo,
}: {
  title: string
  items: { node: GraphNode; type: string }[]
  onJumpTo: (id: string) => void
}) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul className="flex flex-col gap-0.5">
        {items.map((it, i) => (
          <li key={`${title}-${i}-${it.node.id}`}>
            <button
              type="button"
              onClick={() => onJumpTo(it.node.id)}
              className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-foreground transition-colors hover:bg-muted"
            >
              <span
                className={`inline-block h-2 w-2 flex-none ${it.node.type === "initiative" ? "rounded-[2px]" : "rounded-full"}`}
                style={{
                  backgroundColor:
                    it.node.type === "initiative"
                      ? "#0f172a"
                      : PRIORITY_FILL[it.node.priority ?? "none"],
                }}
              />
              <span className="flex-1 truncate">{it.node.title}</span>
              <span className="font-mono text-[9px] text-muted-foreground">
                {EDGE_TYPE_LABEL[it.type] ?? it.type}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── DetailPanel ──────────────────────────────────────────────────────────────

export function DetailPanel({
  node,
  neighbors,
  onClose,
  onJumpTo,
  onOpen,
}: {
  node: GraphNode
  neighbors: {
    incoming: { node: GraphNode; type: string }[]
    outgoing: { node: GraphNode; type: string }[]
  } | null
  onClose: () => void
  onJumpTo: (id: string) => void
  onOpen: (id: string, kind: string) => void
}) {
  const priorityColor = PRIORITY_FILL[node.priority ?? "none"]
  const statusRing = node.status ? STATUS_RING[node.status] : null
  const isInitiative = node.type === "initiative"

  return (
    <aside
      className="absolute right-3 top-3 z-10 flex w-[320px] flex-col gap-3 rounded-xl border border-border bg-card/95 p-4 shadow-lg backdrop-blur"
      style={{ maxHeight: "calc(78vh - 24px)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-3 w-3 ${isInitiative ? "rounded-[3px]" : "rounded-full"}`}
            style={{
              backgroundColor: isInitiative ? "#0f172a" : priorityColor,
              boxShadow: statusRing ? `0 0 0 2px ${statusRing}` : undefined,
            }}
          />
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {node.type}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ×
        </button>
      </div>

      <h2 className="text-sm font-semibold leading-snug text-foreground">
        {node.title}
      </h2>

      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {node.priority && <Badge label={node.priority} fill={priorityColor} />}
        {node.status && (
          <Badge
            label={node.status.replace("_", " ")}
            fill="#fff"
            outline={statusRing ?? "#a1a1aa"}
            text="#27272a"
          />
        )}
        {node.owner && <Badge label={`@${node.owner}`} fill="#f4f4f5" text="#3f3f46" />}
        {node.area && <Badge label={node.area} fill="#f4f4f5" text="#3f3f46" />}
        {node.iteration && <Badge label={node.iteration} fill="#f4f4f5" text="#3f3f46" />}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onOpen(node.id, node.type)}
          className="flex-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-foreground/90"
        >
          Open {isInitiative ? "artifact" : "task"} →
        </button>
      </div>

      {neighbors &&
        (neighbors.incoming.length > 0 || neighbors.outgoing.length > 0) && (
          <div className="flex flex-col gap-2 overflow-y-auto pr-1 text-xs">
            {neighbors.outgoing.length > 0 && (
              <NeighborGroup
                title="Outgoing"
                items={neighbors.outgoing}
                onJumpTo={onJumpTo}
              />
            )}
            {neighbors.incoming.length > 0 && (
              <NeighborGroup
                title="Incoming"
                items={neighbors.incoming}
                onJumpTo={onJumpTo}
              />
            )}
          </div>
        )}

      <p className="font-mono text-[10px] text-muted-foreground">{node.id}</p>
    </aside>
  )
}
