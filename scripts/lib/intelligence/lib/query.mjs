// Read-side queries over .kg/graph.sqlite.
import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  return new DatabaseSync(path, { readOnly: true });
}

const rowNode = (r) => r && ({ ...r, tags: JSON.parse(r.tags_json ?? '[]'), meta: JSON.parse(r.meta_json ?? '{}'), tags_json: undefined, meta_json: undefined });
const rowEdge = (r) => ({ ...r, attrs: JSON.parse(r.attrs_json ?? '{}'), evidence: JSON.parse(r.evidence_json ?? '[]'), derived: Boolean(r.derived), attrs_json: undefined, evidence_json: undefined });

export function getNode(db, id) {
  return rowNode(db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) ?? null);
}

export function report(db) {
  const r = db.prepare("SELECT value FROM build_meta WHERE key = 'report'").get();
  return r ? JSON.parse(r.value) : null;
}

/** Edges touching `id`, grouped by relation, with the other endpoint's title. */
export function backlinks(db, id) {
  const rows = db.prepare(`
    SELECT e.*, n.title AS src_title, n.kind AS src_kind FROM edges e JOIN nodes n ON n.id = e.src
    WHERE e.dst = ? ORDER BY e.rel, e.src`).all(id);
  const grouped = {};
  for (const r of rows) (grouped[r.rel] ??= []).push({ ...rowEdge(r), src_title: r.src_title, src_kind: r.src_kind });
  return grouped;
}

export function children(db, id) {
  return db.prepare(`
    SELECT n.id, n.kind, n.title, n.status, n.owner FROM edges e JOIN nodes n ON n.id = e.dst
    WHERE e.src = ? AND e.rel = 'parent_of' ORDER BY n.kind, n.id`).all(id);
}

/**
 * Bounded typed walk. direction: out | in | both. rels: optional allowlist.
 * Returns { nodes: {id: node}, edges: [edge with hop] }.
 */
export function neighborhood(db, id, { hops = 2, rels = null, direction = 'out', includeDerived = false } = {}) {
  const nodes = {};
  const edges = [];
  const start = getNode(db, id);
  if (!start) return { nodes, edges, missing: id };
  nodes[id] = start;
  let frontier = [id];
  const seenEdges = new Set();
  const relFilter = rels?.length ? ` AND rel IN (${rels.map(() => '?').join(',')})` : '';
  const derivedFilter = includeDerived ? '' : ' AND derived = 0';
  const qOut = db.prepare(`SELECT * FROM edges WHERE src = ?${relFilter}${derivedFilter}`);
  const qIn = db.prepare(`SELECT * FROM edges WHERE dst = ?${relFilter}${derivedFilter}`);
  const qNode = db.prepare('SELECT * FROM nodes WHERE id = ?');
  for (let h = 1; h <= hops && frontier.length; h++) {
    const next = new Set();
    for (const cur of frontier) {
      const rows = [];
      const args = rels?.length ? [cur, ...rels] : [cur];
      if (direction !== 'in') rows.push(...qOut.all(...args));
      if (direction !== 'out') rows.push(...qIn.all(...args));
      for (const r of rows) {
        const k = `${r.src}|${r.rel}|${r.dst}`;
        if (seenEdges.has(k)) continue;
        seenEdges.add(k);
        edges.push({ ...rowEdge(r), hop: h });
        const other = r.src === cur ? r.dst : r.src;
        if (!nodes[other]) { nodes[other] = rowNode(qNode.get(other)); next.add(other); }
      }
    }
    frontier = [...next];
  }
  return { nodes, edges };
}

/** Shortest undirected path (authored edges only). */
export function path(db, from, to, maxDepth = 6) {
  if (from === to) return [];
  const q = db.prepare('SELECT src, rel, dst FROM edges WHERE derived = 0 AND (src = ? OR dst = ?)');
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const r of q.all(cur, cur)) {
        const other = r.src === cur ? r.dst : r.src;
        if (prev.has(other)) continue;
        prev.set(other, { via: cur, edge: r });
        if (other === to) {
          const out = [];
          for (let x = to; prev.get(x); x = prev.get(x).via) out.unshift(prev.get(x).edge);
          return out;
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

export function isolated(db, ns = null) {
  const where = ns ? 'WHERE n.ns = ?' : '';
  return db.prepare(`
    SELECT n.id, n.kind, n.title FROM nodes n ${where}
    ${ns ? 'AND' : 'WHERE'} NOT EXISTS (SELECT 1 FROM edges e WHERE e.derived = 0 AND (e.src = n.id OR e.dst = n.id))
    ORDER BY n.id`).all(...(ns ? [ns] : []));
}

export function search(db, term, limit = 20) {
  return db.prepare(`SELECT id, kind, memory, title, status FROM nodes WHERE id LIKE ? OR title LIKE ? ORDER BY id LIMIT ?`)
    .all(`%${term}%`, `%${term}%`, limit);
}

/** All playbooks carrying a procedure graph: [{playbookId, graph}]. */
export function procedureGraphs(db) {
  return db.prepare("SELECT id, meta_json FROM nodes WHERE ns = 'mgmt' AND kind = 'playbook'").all()
    .map((r) => ({ playbookId: r.id, graph: JSON.parse(r.meta_json ?? '{}').x_procedure_graph }))
    .filter((x) => x.graph);
}

export function edgeEvents(db, playbook = null) {
  const rows = playbook
    ? db.prepare('SELECT * FROM edge_events WHERE playbook = ? ORDER BY proposed_at, proposal_id').all(playbook.startsWith('mgmt:') ? playbook : `mgmt:${playbook}`)
    : db.prepare('SELECT * FROM edge_events ORDER BY playbook, proposed_at, proposal_id').all();
  return rows.map((r) => ({ ...r, edits: JSON.parse(r.edits_json ?? '{}'), edits_json: undefined }));
}
