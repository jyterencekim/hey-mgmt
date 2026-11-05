// workspace/fisher/knowledge/*.jsonl (external activity: Slack, Drive, GitHub,
// Confluence) -> ext: nodes; `linked_artifact` becomes a `mentions` edge.
// Rows classified `skip` are not projected.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { makeNode, makeEdge } from '../lib/model.mjs';
import { isArtifactId } from '../lib/frontmatter.mjs';

export function loadFisherKnowledge(root, report) {
  const nodes = [];
  const edges = [];
  const dir = join(root, 'workspace', 'fisher', 'knowledge');
  if (!existsSync(dir)) return { nodes, edges };
  const seen = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
    const path = join(dir, f);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let r;
      try { r = JSON.parse(line); } catch (err) { report.parseErrors.push({ path: relative(root, path), error: String(err.message) }); continue; }
      if (!r.id || r.classification === 'skip') continue;
      const id = `ext:${r.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      nodes.push(makeNode({
        id, kind: r.object_type ?? r.source ?? 'external', memory: 'episodic',
        title: r.title ?? r.summary ?? r.id, status: r.status ?? null, owner: r.workspace_owner ?? null,
        tags: Array.isArray(r.topics) ? r.topics : [], created_at: r.date ?? null, as_of: r.changed_at ?? null,
        source: relative(root, path),
        meta: { source: r.source, url: r.url ?? null, classification: r.classification ?? null, relevance_score: r.relevance_score ?? null },
      }));
      if (r.linked_artifact) {
        const stem = basename(String(r.linked_artifact)).replace(/\.md$/, '');
        if (isArtifactId(stem)) {
          edges.push(makeEdge({
            src: id, rel: 'mentions', dst: `mgmt:${stem}`, asserted_by: 'agent:fisher',
            asserted_at: r.changed_at ? String(r.changed_at).slice(0, 10) : r.date ?? null,
            evidence: r.url ? [r.url] : [], strength: 'heuristic_signal', origin: 'fisher_linked_artifact',
          }));
        }
      }
    }
  }
  return { nodes, edges };
}
