// Procedural graphs (Lu et al., arXiv 2609.09153): validation mirrors the
// paper's PrepareCandidate structural checks; serialization mirrors the
// Appendix B.5 local-graph context that the guidance model reads.
import { PROCEDURAL_RELATIONS } from './model.mjs';

export const PROCEDURE_SCHEMA = 'procedural-graph/v0';
export const NODE_KINDS = ['start', 'end', 'action', 'check', 'state'];

/**
 * @param {object} g  { schema, cycle_policy, nodes:[{id,kind,tool?,title?}], edges:[{src,rel,dst,condition?,guidance,pitfalls?}] }
 * @returns {string[]} errors (empty when valid)
 */
export function validateProcedureGraph(g, label = 'procedure') {
  const errors = [];
  if (!g || typeof g !== 'object') return [`${label}: graph is not an object`];
  if (g.schema !== PROCEDURE_SCHEMA) errors.push(`${label}: schema must be ${PROCEDURE_SCHEMA}`);
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const edges = Array.isArray(g.edges) ? g.edges : [];
  if (nodes.length === 0) errors.push(`${label}: no nodes`);

  const ids = new Set();
  for (const n of nodes) {
    if (!n?.id) { errors.push(`${label}: node without id`); continue; }
    if (ids.has(n.id)) errors.push(`${label}: duplicate node id ${n.id}`);
    ids.add(n.id);
    const kind = n.kind ?? 'action';
    if (!NODE_KINDS.includes(kind)) errors.push(`${label}: node ${n.id} has unknown kind ${kind}`);
    if (kind === 'action' && !n.tool) errors.push(`${label}: action node ${n.id} must name a tool`);
  }

  const out = new Map([...ids].map((id) => [id, []]));
  for (const e of edges) {
    if (!e?.src || !e?.dst) { errors.push(`${label}: edge without src/dst`); continue; }
    if (!ids.has(e.src)) errors.push(`${label}: edge source ${e.src} does not exist`);
    if (!ids.has(e.dst)) errors.push(`${label}: edge target ${e.dst} does not exist`);
    if (!PROCEDURAL_RELATIONS.has(e.rel)) errors.push(`${label}: edge ${e.src}->${e.dst} has non-procedural relation ${e.rel}`);
    if (!e.guidance || !String(e.guidance).trim()) errors.push(`${label}: edge ${e.src}->${e.dst} must carry guidance`);
    if (ids.has(e.src) && ids.has(e.dst)) out.get(e.src).push(e.dst);
  }

  // Every node must reach a terminal (zero out-degree) node: reverse BFS from the
  // terminals, which is correct in the presence of cycles (a forward DFS that
  // memoizes "false" while a node is still on the stack is not).
  const terminals = new Set([...out].filter(([, t]) => t.length === 0).map(([id]) => id));
  if (terminals.size === 0 && ids.size > 0) errors.push(`${label}: no terminal node (every node has outgoing edges)`);
  const preds = new Map([...ids].map((id) => [id, []]));
  for (const [src, targets] of out) for (const t of targets) preds.get(t).push(src);
  const reaches = new Set(terminals);
  const queue = [...terminals];
  while (queue.length) { const cur = queue.pop(); for (const p of preds.get(cur) ?? []) if (!reaches.has(p)) { reaches.add(p); queue.push(p); } }
  for (const id of ids) if (!reaches.has(id)) errors.push(`${label}: node ${id} cannot reach a terminal node`);

  if ((g.cycle_policy ?? 'acyclic') === 'acyclic') {
    const color = new Map();
    const dfs = (id) => {
      color.set(id, 1);
      for (const t of out.get(id) ?? []) {
        if (color.get(t) === 1) return `${id}->${t}`;
        if (!color.has(t)) { const c = dfs(t); if (c) return c; }
      }
      color.set(id, 2);
      return null;
    };
    for (const id of ids) {
      if (!color.has(id)) { const c = dfs(id); if (c) { errors.push(`${label}: cycle detected at ${c} (cycle_policy: acyclic)`); break; } }
    }
  }
  return errors;
}

/**
 * Serialize the h-hop outgoing neighbourhood of `at` in the paper's format.
 * Falls back to the whole graph when `at` does not match a node.
 */
export function serializeGuidance(g, at, hops = 2) {
  const nodes = new Map((g.nodes ?? []).map((n) => [n.id, n]));
  const edgesFrom = (id) => (g.edges ?? []).filter((e) => e.src === id);
  const lines = [];
  const fmtEdge = (e) => {
    const cond = e.condition ? ` (Condition: ${e.condition})` : '';
    lines.push(`- Transition: [${e.src}] → [${e.dst}]${cond}`);
    lines.push(`  * Guidance: ${e.guidance}`);
    if (e.pitfalls) lines.push(`  * Pitfalls to Avoid: ${e.pitfalls}`);
  };

  if (!at || !nodes.has(at)) {
    lines.push(`Complete Procedural Graph (no active node matched${at ? `: ${at}` : ''}):`);
    for (const n of nodes.values()) lines.push(`Node: [${n.id}] (Type: ${(n.kind ?? 'action').toUpperCase()})${n.title ? ` — ${n.title}` : ''}`);
    lines.push('Transitions:');
    for (const e of g.edges ?? []) fmtEdge(e);
    return lines.join('\n');
  }

  const n = nodes.get(at);
  lines.push(`Active Cognitive Node: [${n.id}] (Type: ${(n.kind ?? 'action').toUpperCase()})`);
  if (n.title || n.tool) lines.push(`Description: ${n.title ?? ''}${n.tool ? ` (tool: ${n.tool})` : ''}`.trim());
  let frontier = [at];
  const visited = new Set([at]);
  for (let h = 1; h <= hops; h++) {
    const es = frontier.flatMap(edgesFrom);
    if (es.length === 0) break;
    lines.push(h === 1 ? 'Immediate Transition Options (Hop 1):' : `Subsequent Horizon (Hop ${h}):`);
    for (const e of es) fmtEdge(e);
    frontier = [...new Set(es.map((e) => e.dst).filter((d) => !visited.has(d)))];
    frontier.forEach((d) => visited.add(d));
  }
  return lines.join('\n');
}
