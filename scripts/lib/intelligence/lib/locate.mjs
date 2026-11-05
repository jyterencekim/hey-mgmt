// Localization: map an agent's last tool call to an action node across every
// procedural graph in the projection (exact tool match first, then prefix, then
// token overlap), the paper's Match(a_{t-1}, V) with a small fuzzy fallback.
const tokens = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9._-]+/).filter((t) => t.length > 1);

/**
 * @param {Array<{playbookId, graph}>} graphs
 * @param {string} tool  the last tool call / command line
 * @returns {{playbookId, node, score, how} | null}
 */
export function locate(graphs, tool) {
  const t = String(tool ?? '').trim().toLowerCase();
  if (!t) return null;
  let best = null;
  const consider = (c) => { if (!best || c.score > best.score) best = c; };
  for (const { playbookId, graph } of graphs) {
    for (const n of graph.nodes ?? []) {
      if (!n.tool) continue;
      const nt = String(n.tool).toLowerCase();
      if (nt === t) return { playbookId, node: n.id, score: 1, how: 'exact' };
      if (t.startsWith(nt) || nt.startsWith(t)) consider({ playbookId, node: n.id, score: 0.9, how: 'prefix' });
      const a = new Set(tokens(nt));
      const b = new Set(tokens(t));
      const inter = [...a].filter((x) => b.has(x)).length;
      const jaccard = inter / (new Set([...a, ...b]).size || 1);
      if (jaccard >= 0.5) consider({ playbookId, node: n.id, score: 0.5 + jaccard / 2, how: 'tokens' });
    }
  }
  return best;
}
