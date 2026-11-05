import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import cytoscape from "cytoscape"
import fcose from "cytoscape-fcose"

import type { GraphData, GraphNode, ColorBy, FilterState, StyleRule } from "./types"
import {
  STATUS_OPEN,
  INITIATIVE_FILL,
  nodeColor,
  nodeRingColor,
} from "./constants"
import { resolveInitialState, persistState, syncToUrl } from "./persistence"
import { DetailPanel } from "./DetailPanel"
import { ControlsBar } from "./ControlsBar"

cytoscape.use(fcose as cytoscape.Ext)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

function nodeHref(id: string, kind: string): string {
  return kind === "task" ? `/tasks/${id}/` : `/artifacts/${id}/`
}

// ─── TaskGraph ────────────────────────────────────────────────────────────────

export default function TaskGraph() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  // Store fcose positions so we can restore them when concentric clears
  const fcosePosRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const [data, setData] = useState<GraphData | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── All state initialised from URL / localStorage on first render ───────────
  const init = useMemo(() => resolveInitialState(), [])
  const [showDone, setShowDone] = useState(init.showDone)
  const [showOrphans, setShowOrphans] = useState(init.showOrphans)
  const [searchQuery, setSearchQuery] = useState(init.searchQuery)
  const [depth, setDepth] = useState(init.depth)
  const [selectedId, setSelectedId] = useState<string | null>(init.selectedId)
  const [colorBy, setColorBy] = useState<ColorBy>(init.colorBy)
  const [filters, setFilters] = useState<FilterState>(init.filters)

  // Debounce ref for search URL sync
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Fetch data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/graph/data.json")
      .then((r) => r.json())
      .then((d: GraphData) => setData(d))
      .catch((err: Error) => setError(err.message))
  }, [])

  // ── Persist to localStorage whenever relevant state changes ──────────────────
  useEffect(() => {
    persistState(showDone, showOrphans, depth, colorBy, filters)
  }, [showDone, showOrphans, depth, colorBy, filters])

  // ── Sync to URL (search debounced 300ms, rest immediate) ─────────────────────
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      syncToUrl(showDone, showOrphans, searchQuery, depth, selectedId, colorBy)
    }, 300)
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    }
  }, [showDone, showOrphans, searchQuery, depth, selectedId, colorBy])

  // ── Filtered graph data ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return null

    const keptNode = (n: GraphNode) => {
      if (!showDone && n.status && !STATUS_OPEN.has(n.status)) return false
      // Multi-select filter pills: OR within dimension, AND across dimensions
      if (filters.owners.length > 0 && n.type !== "initiative") {
        if (!n.owner || !filters.owners.includes(n.owner)) return false
      }
      if (filters.areas.length > 0 && n.type !== "initiative") {
        if (!n.area || !filters.areas.includes(n.area)) return false
      }
      if (filters.iterations.length > 0 && n.type !== "initiative") {
        if (!n.iteration || !filters.iterations.includes(n.iteration)) return false
      }
      return true
    }

    const nodes = data.nodes.filter(keptNode)
    const kept = new Set(nodes.map((n) => n.id))
    const edges = data.edges.filter(
      (e) => kept.has(e.source) && kept.has(e.target)
    )

    if (!showOrphans) {
      const connected = new Set<string>()
      for (const e of edges) {
        connected.add(e.source)
        connected.add(e.target)
      }
      const filteredNodes = nodes.filter(
        (n) => n.type === "initiative" || connected.has(n.id)
      )
      return { nodes: filteredNodes, edges }
    }
    return { nodes, edges }
  }, [data, showDone, showOrphans, filters])

  // ── Node index ────────────────────────────────────────────────────────────────
  const nodeIndex = useMemo(() => {
    const m = new Map<string, GraphNode>()
    for (const n of filtered?.nodes ?? []) m.set(n.id, n)
    return m
  }, [filtered])

  // ── Distinct filter dimension values (from full data, not filtered) ───────────
  const { allOwners, allAreas, allIterations, ownerCounts, areaCounts, iterationCounts } =
    useMemo(() => {
      const owners = new Map<string, number>()
      const areas = new Map<string, number>()
      const iterations = new Map<string, number>()
      for (const n of data?.nodes ?? []) {
        if (n.type === "initiative") continue
        if (n.owner) owners.set(n.owner, (owners.get(n.owner) ?? 0) + 1)
        if (n.area) areas.set(n.area, (areas.get(n.area) ?? 0) + 1)
        if (n.iteration) iterations.set(n.iteration, (iterations.get(n.iteration) ?? 0) + 1)
      }
      // Sort iterations descending (they look like 2026-W18)
      const sortedIterations = Array.from(iterations.keys()).sort((a, b) =>
        b.localeCompare(a)
      )
      return {
        allOwners: Array.from(owners.keys()).sort(),
        allAreas: Array.from(areas.keys()).sort(),
        allIterations: sortedIterations,
        ownerCounts: owners,
        areaCounts: areas,
        iterationCounts: iterations,
      }
    }, [data])

  // ── Search match ──────────────────────────────────────────────────────────────
  const searchMatch = useMemo(() => {
    if (!searchQuery.trim() || !filtered) return null
    const q = searchQuery.trim().toLowerCase()
    const match = filtered.nodes.find((n) => n.title.toLowerCase().includes(q))
    return match?.id ?? null
  }, [searchQuery, filtered])

  const activeFocusId = selectedId ?? searchMatch
  const focusNode = activeFocusId ? nodeIndex.get(activeFocusId) ?? null : null

  // ── Neighbor info for side panel ──────────────────────────────────────────────
  const neighborInfo = useMemo(() => {
    if (!activeFocusId || !filtered) return null
    const incoming: { node: GraphNode; type: string }[] = []
    const outgoing: { node: GraphNode; type: string }[] = []
    for (const e of filtered.edges) {
      if (e.source === activeFocusId) {
        const n = nodeIndex.get(e.target)
        if (n) outgoing.push({ node: n, type: e.type })
      } else if (e.target === activeFocusId) {
        const n = nodeIndex.get(e.source)
        if (n) incoming.push({ node: n, type: e.type })
      }
    }
    return { incoming, outgoing }
  }, [activeFocusId, filtered, nodeIndex])

  // ── Apply focus classes + neighborhood fade ───────────────────────────────────
  const applyFocusState = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return

    if (!activeFocusId) {
      cy.elements().removeClass("faded focus-member focus-root")
      return
    }

    const focusEle = cy.getElementById(activeFocusId)
    if (focusEle.empty()) return

    const inNeighborhood = new Set<string>([activeFocusId])
    let frontier = new Set<string>([activeFocusId])
    for (let hop = 0; hop < depth; hop++) {
      const next = new Set<string>()
      for (const id of frontier) {
        cy.getElementById(id)
          .neighborhood("node")
          .forEach((n) => {
            if (!inNeighborhood.has(n.id())) {
              inNeighborhood.add(n.id())
              next.add(n.id())
            }
          })
      }
      frontier = next
    }

    cy.nodes().forEach((n) => {
      n.removeClass("focus-root")
      if (n.id() === activeFocusId) {
        n.removeClass("faded").addClass("focus-member focus-root")
      } else if (inNeighborhood.has(n.id())) {
        n.removeClass("faded").addClass("focus-member")
      } else {
        n.addClass("faded").removeClass("focus-member")
      }
    })
    cy.edges().forEach((e) => {
      const srcIn = inNeighborhood.has(e.source().id())
      const tgtIn = inNeighborhood.has(e.target().id())
      if (srcIn && tgtIn) {
        e.removeClass("faded").addClass("highlighted")
      } else {
        e.addClass("faded").removeClass("highlighted")
      }
    })
  }, [activeFocusId, depth])

  useEffect(() => {
    applyFocusState()
  }, [applyFocusState])

  // ── Concentric layout on focus / fcose restore on clear ───────────────────────
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    if (!activeFocusId) {
      // Restore saved fcose positions (animate back)
      if (fcosePosRef.current.size > 0) {
        cy.nodes().forEach((n) => {
          const pos = fcosePosRef.current.get(n.id())
          if (pos) n.position(pos)
        })
        cy.animate(
          { fit: { eles: cy.elements(), padding: 56 } },
          { duration: 500, easing: "ease-out" }
        )
      }
      return
    }

    const focusEle = cy.getElementById(activeFocusId)
    if (focusEle.empty()) return

    // Build hop-distance map for concentric ordering
    const hopMap = new Map<string, number>([[activeFocusId, 0]])
    let frontier = new Set<string>([activeFocusId])
    for (let hop = 1; hop <= depth; hop++) {
      const next = new Set<string>()
      for (const id of frontier) {
        cy.getElementById(id)
          .neighborhood("node")
          .forEach((n) => {
            if (!hopMap.has(n.id())) {
              hopMap.set(n.id(), hop)
              next.add(n.id())
            }
          })
      }
      frontier = next
    }

    // Collect the focus subgraph (root + neighborhood)
    const subgraphIds = new Set(hopMap.keys())
    const focusNodes = cy.nodes().filter((n) => subgraphIds.has(n.id()))
    const focusEdges = cy.edges().filter(
      (e) => subgraphIds.has(e.source().id()) && subgraphIds.has(e.target().id())
    )
    const subgraph = focusNodes.union(focusEdges)

    // Save current positions of ALL nodes before relayout (only once per focus)
    // We save on first focus set, not on depth change, to avoid overwriting with
    // concentric positions.
    if (!fcosePosRef.current.has(activeFocusId)) {
      cy.nodes().forEach((n) => {
        fcosePosRef.current.set(n.id(), { ...n.position() })
      })
    }

    const layout = subgraph.layout({
      name: "concentric",
      animate: true,
      animationDuration: 500,
      animationEasing: "ease-out" as cytoscape.Css.TransitionTimingFunction,
      concentric: (n: cytoscape.NodeSingular) => {
        const hop = hopMap.get(n.id()) ?? depth + 1
        return depth + 1 - hop // higher = inner ring
      },
      levelWidth: () => 1,
      minNodeSpacing: 40,
      spacingFactor: 1.4,
      // Important: do NOT fit here. The viewport adjustment happens once,
      // after layoutstop, so concentric and viewport-fit don't fight.
      fit: false,
    } as cytoscape.LayoutOptions)

    layout.one("layoutstop", () => {
      cy.animate(
        { fit: { eles: subgraph, padding: 80 } },
        { duration: 420, easing: "ease-out" }
      )
    })
    layout.run()
  }, [activeFocusId, depth])

  // ── Pulsing RAF on focus root (skip when tab hidden) ─────────────────────────
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !activeFocusId) return
    let cancelled = false
    let phase = 0
    const tick = () => {
      if (cancelled) return
      // Skip frames when tab is hidden — saves battery / CPU
      if (!document.hidden) {
        phase += 0.12
        const root = cy.getElementById(activeFocusId)
        if (!root.empty()) {
          const w = 2.5 + Math.sin(phase) * 1.5
          root.style("border-width", w)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    let raf = requestAnimationFrame(tick)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      const root = cy.getElementById(activeFocusId)
      if (!root.empty()) root.removeStyle("border-width")
    }
  }, [activeFocusId])

  // ── Build / rebuild cytoscape instance ───────────────────────────────────────
  useEffect(() => {
    if (!filtered || !containerRef.current) return
    if (cyRef.current) {
      cyRef.current.destroy()
      cyRef.current = null
    }
    // Clear saved positions on full rebuild
    fcosePosRef.current = new Map()

    const degreeMap = new Map<string, number>()
    for (const n of filtered.nodes) degreeMap.set(n.id, 0)
    for (const e of filtered.edges) {
      degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1)
      degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1)
    }

    const cyNodes = filtered.nodes.map((n) => {
      const degree = degreeMap.get(n.id) ?? 0
      const size =
        n.type === "initiative" ? 56 : clamp(20 + degree * 3, 20, 46)
      return {
        data: {
          id: n.id,
          label: n.title,
          kind: n.type,
          status: n.status ?? "unknown",
          priority: n.priority ?? "none",
          owner: n.owner ?? "",
          area: n.area ?? "",
          iteration: n.iteration ?? "",
          nodeSize: size,
        },
      }
    })

    const cyEdges = filtered.edges.map((e, i) => ({
      data: {
        id: `e${i}`,
        source: e.source,
        target: e.target,
        type: e.type,
      },
    }))

    const style: StyleRule[] = [
      {
        selector: "node",
        style: {
          label: "",
          "font-family": "Geist Variable, system-ui, sans-serif",
          "background-color": (ele: cytoscape.NodeSingular) => {
            if (ele.data("kind") === "initiative") return INITIATIVE_FILL
            return nodeColor(
              colorBy,
              ele.data("priority") as string,
              ele.data("owner") as string || null,
              ele.data("area") as string || null,
              ele.data("iteration") as string || null
            )
          },
          "background-opacity": 1,
          "border-width": 1.5,
          "border-color": (ele: cytoscape.NodeSingular) => {
            if (ele.data("kind") === "initiative") return INITIATIVE_FILL
            return nodeRingColor(
              colorBy,
              ele.data("priority") as string,
              ele.data("owner") as string || null,
              ele.data("area") as string || null,
              ele.data("iteration") as string || null,
              ele.data("status") as string
            )
          },
          "border-opacity": 0.95,
          width: "data(nodeSize)",
          height: "data(nodeSize)",
          "overlay-padding": 6,
          "transition-property":
            "opacity, border-width, border-color, width, height, background-color",
          "transition-duration": 200,
          "transition-timing-function": "ease-out",
        },
      },
      {
        selector: 'node[kind = "initiative"]',
        style: {
          label: "data(label)",
          "font-family": "Geist Variable, system-ui, sans-serif",
          "font-size": 13,
          "font-weight": 600,
          color: "#0f172a",
          "background-color": "#0f172a",
          "background-fill": "radial-gradient",
          "background-gradient-stop-colors": "#1e293b #0f172a",
          "background-gradient-stop-positions": "0% 100%",
          shape: "round-rectangle",
          "border-width": 0,
          width: 56,
          height: 56,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 12,
          "text-wrap": "wrap",
          "text-max-width": "180px",
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.95,
          "text-background-padding": "5px",
          "text-background-shape": "roundrectangle",
          "text-border-width": 1,
          "text-border-color": "#e4e4e7",
          "text-border-opacity": 1,
          "z-index": 10,
        },
      },
      // Consolidated: focus-member and focused share identical label styles
      {
        selector: "node.focus-member, node.focused",
        style: {
          label: "data(label)",
          "font-family": "Geist Variable, system-ui, sans-serif",
          "font-size": 11,
          "font-weight": 500,
          color: "#27272a",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 8,
          "text-wrap": "wrap",
          "text-max-width": "200px",
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.96,
          "text-background-padding": "4px",
          "text-background-shape": "roundrectangle",
          "text-border-width": 1,
          "text-border-color": "#e4e4e7",
          "text-border-opacity": 1,
          "z-index": 20,
        },
      },
      {
        selector: "node.focus-root",
        style: {
          "border-color": "#0f172a",
          "border-opacity": 1,
          // Subtle drop-shadow on focus root
          "shadow-blur": 12,
          "shadow-color": "#0f172a",
          "shadow-opacity": 0.18,
          "shadow-offset-x": 0,
          "shadow-offset-y": 2,
          "z-index": 30,
        },
      },
      {
        selector: "node.hovered",
        style: {
          "border-width": 3,
          "border-color": "#18181b",
          "z-index": 25,
        },
      },
      // Initiative hover: match regular node hover more cohesively (full opacity ring)
      {
        selector: 'node[kind = "initiative"].hovered',
        style: {
          "border-width": 3,
          "border-color": "#0f172a",
          "border-opacity": 1,
        },
      },
      {
        selector: "edge",
        style: {
          "font-family": "Geist Mono Variable, ui-monospace, monospace",
          width: 1.2,
          "line-color": "#d4d4d8",
          "curve-style": "unbundled-bezier",
          "control-point-distances": [-12],
          "control-point-weights": [0.5],
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#a1a1aa",
          "arrow-scale": 0.85,
          opacity: 0.55,
          "transition-property": "opacity, line-color, width",
          "transition-duration": 160,
        },
      },
      {
        selector: 'edge[type = "child_of"], edge[type = "parent_of"]',
        style: {
          "line-color": "#64748b",
          "target-arrow-color": "#64748b",
          width: 1.6,
          opacity: 0.85,
        },
      },
      {
        selector: 'edge[type = "blocks"], edge[type = "blocked_by"]',
        style: {
          "line-color": "#f43f5e",
          "target-arrow-color": "#f43f5e",
          "line-style": "dashed",
          width: 1.6,
        },
      },
      {
        selector: "edge.highlighted",
        style: {
          opacity: 1,
          width: 2.4,
          "z-index": 15,
        },
      },
      {
        selector: "node.faded",
        style: { opacity: 0.1 },
      },
      {
        selector: "edge.faded",
        style: { opacity: 0.04 },
      },
    ]

    const stylesheet = style as unknown as cytoscape.StylesheetCSS[]
    const cy = cytoscape({
      container: containerRef.current,
      elements: [...cyNodes, ...cyEdges],
      wheelSensitivity: 0.25,
      minZoom: 0.18,
      maxZoom: 3.2,
      style: stylesheet,
      layout: {
        name: "fcose",
        animate: true,
        animationDuration: 700,
        animationEasing: "ease-out",
        nodeRepulsion: () => 10500,
        idealEdgeLength: () => 120,
        edgeElasticity: () => 0.22,
        gravity: 0.14,
        gravityRange: 3.6,
        packComponents: true,
        componentSpacing: 96,
        nestingFactor: 0.8,
        randomize: true,
        nodeSeparation: 115,
      } as cytoscape.LayoutOptions,
    })

    cy.on("tap", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      const id = node.id() as string
      const originalEvent = evt.originalEvent as MouseEvent | undefined
      if (originalEvent?.shiftKey) {
        const kind = node.data("kind") as string
        window.location.assign(nodeHref(id, kind))
        return
      }
      setSelectedId(id)
    })

    cy.on("dbltap", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      const id = node.id() as string
      const kind = node.data("kind") as string
      window.location.assign(nodeHref(id, kind))
    })

    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedId(null)
    })

    cy.on("mouseover", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      const neighborhood = node.closedNeighborhood()
      if (!cyRef.current) return
      const hasFocus = cy.nodes(".focus-member").length > 0
      if (!hasFocus) {
        cy.elements().addClass("faded")
        neighborhood.removeClass("faded")
      }
      neighborhood.nodes().addClass("focused")
      neighborhood.edges().addClass("highlighted")
      node.addClass("hovered")
      const container = containerRef.current
      if (container) container.style.cursor = "pointer"
    })

    cy.on("mouseout", "node", () => {
      cy.nodes().removeClass("focused hovered")
      cy.edges().removeClass("highlighted")
      const hasFocus = cy.nodes(".focus-member").length > 0
      if (!hasFocus) {
        cy.elements().removeClass("faded")
      }
      const container = containerRef.current
      if (container) container.style.cursor = "default"
    })

    // Cluster drag: initiative drags its neighbors
    let dragContext: {
      leader: cytoscape.NodeSingular
      followers: cytoscape.NodeCollection
      lastX: number
      lastY: number
    } | null = null

    cy.on("grab", "node", (evt) => {
      const node = evt.target as cytoscape.NodeSingular
      if (node.data("kind") !== "initiative") return
      const followers = node
        .neighborhood("node")
        .filter((n) => n.data("kind") !== "initiative")
      const p = node.position()
      dragContext = { leader: node, followers, lastX: p.x, lastY: p.y }
    })

    cy.on("drag", "node", (evt) => {
      if (!dragContext) return
      const node = evt.target as cytoscape.NodeSingular
      if (node.id() !== dragContext.leader.id()) return
      const p = node.position()
      const dx = p.x - dragContext.lastX
      const dy = p.y - dragContext.lastY
      if (dx === 0 && dy === 0) return
      dragContext.followers.forEach((child) => {
        const cp = child.position()
        child.position({ x: cp.x + dx, y: cp.y + dy })
      })
      dragContext.lastX = p.x
      dragContext.lastY = p.y
    })

    cy.on("free", "node", () => {
      dragContext = null
    })

    cyRef.current = cy
    return () => {
      cy.destroy()
      cyRef.current = null
    }
    // colorBy is intentionally excluded: we update node styles in-place below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered])

  // ── Live color-by update (no full rebuild) ────────────────────────────────────
  // When colorBy changes, update existing node styles in-place so the graph
  // doesn't tear down and re-animate from scratch.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().forEach((n) => {
      if (n.data("kind") === "initiative") return
      const fill = nodeColor(
        colorBy,
        n.data("priority") as string,
        n.data("owner") as string || null,
        n.data("area") as string || null,
        n.data("iteration") as string || null
      )
      const ring = nodeRingColor(
        colorBy,
        n.data("priority") as string,
        n.data("owner") as string || null,
        n.data("area") as string || null,
        n.data("iteration") as string || null,
        n.data("status") as string
      )
      n.style("background-color", fill)
      n.style("border-color", ring)
    })
  }, [colorBy])

  // ── Keyboard: Esc clears, '/' focuses search ──────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null)
        setSearchQuery("")
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Viewport framing on focus change is handled by the concentric-layout
  // effect's layoutstop callback above — single motion, no fight with the
  // layout animation.

  function resetView() {
    if (cyRef.current) {
      cyRef.current.animate(
        { fit: { eles: cyRef.current.elements(), padding: 56 } },
        { duration: 480, easing: "ease-out" }
      )
    }
  }

  function clearAll() {
    setSearchQuery("")
    setSelectedId(null)
  }

  function navigateTo(id: string, kind: string) {
    window.location.assign(nodeHref(id, kind))
  }

  if (error) {
    return (
      <p className="text-sm text-red-600">Failed to load graph: {error}</p>
    )
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading graph…</p>
  }

  return (
    <div className="flex flex-col gap-3">
      <ControlsBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchInputRef={searchInputRef}
        depth={depth}
        onDepthChange={setDepth}
        colorBy={colorBy}
        onColorByChange={setColorBy}
        filters={filters}
        onFiltersChange={setFilters}
        allOwners={allOwners}
        allAreas={allAreas}
        allIterations={allIterations}
        ownerCounts={ownerCounts}
        areaCounts={areaCounts}
        iterationCounts={iterationCounts}
        showDone={showDone}
        onShowDoneChange={setShowDone}
        showOrphans={showOrphans}
        onShowOrhansChange={setShowOrphans}
        nodeCount={filtered?.nodes.length ?? 0}
        edgeCount={filtered?.edges.length ?? 0}
        hasSelection={!!(selectedId || searchQuery)}
        onClear={clearAll}
        onFit={resetView}
        nodes={data.nodes}
      />

      {/* Canvas + side panel */}
      <div className="relative">
        <div
          ref={containerRef}
          className="graph-canvas h-[78vh] w-full rounded-xl border border-border bg-card"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgb(228 228 231 / 0.4) 1px, transparent 0)",
            backgroundSize: "20px 20px",
          }}
        />

        {focusNode && (
          <DetailPanel
            node={focusNode}
            neighbors={neighborInfo}
            onClose={() => setSelectedId(null)}
            onJumpTo={(id) => setSelectedId(id)}
            onOpen={(id, kind) => navigateTo(id, kind)}
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Click to inspect · double-click or shift+click to open · drag an
        initiative to move its cluster · scroll to zoom ·{" "}
        <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">
          /
        </kbd>{" "}
        to search ·{" "}
        <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">
          Esc
        </kbd>{" "}
        to clear
      </p>
    </div>
  )
}
