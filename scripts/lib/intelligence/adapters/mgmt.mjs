// hey-mgmt artifacts (content/** and workspace/*/**) -> mgmt: nodes,
// typed edges from `relations:`, `mentions` edges from wikilinks and markdown
// links, `evidenced_by` edges for sources that resolve (memory files, papers),
// and procedural graphs from playbooks.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ARTIFACT_TYPES, MEMORY_OF_ARTIFACT, makeNode, makeEdge, normalizeRel } from '../lib/model.mjs';
import { readMarkdown, extractWikiLinks, extractMarkdownLinkStems, isArtifactId } from '../lib/frontmatter.mjs';
import { projectProcedureGraph } from './procedures.mjs';

const SKIP_DIRS = new Set([
  'memory', 'inbox', 'logs', 'raw', 'attachments', 'tmp', 'node_modules', 'assets',
  'exports', 'debug', 'knowledge', 'observations', '.omc', '.hey', '.git', 'digests',
]);

export function* walkMarkdown(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walkMarkdown(p);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield p;
    }
  }
}

export function loadMgmt(root, report) {
  const nodes = [];
  const edges = [];
  const seen = new Map();
  const procedureGraphs = [];
  const files = [...walkMarkdown(join(root, 'content')), ...walkMarkdown(join(root, 'workspace'))];

  for (const path of files) {
    const rel = relative(root, path);
    const { data, body, error } = readMarkdown(path);
    if (error) { report.parseErrors.push({ path: rel, error }); continue; }
    const type = data.type;
    const id = data.id;
    if (!type || !id) continue;
    if (!ARTIFACT_TYPES.includes(type)) { report.unknownTypes.push({ path: rel, type }); continue; }
    if (!String(id).startsWith(`${type}_`)) { report.idPrefixMismatch.push({ path: rel, id, type }); continue; }
    const nid = `mgmt:${id}`;
    if (seen.has(nid)) { report.duplicateIds.push({ id: nid, path: rel, first: seen.get(nid) }); continue; }
    seen.set(nid, rel);

    const owner = data.owner ?? null;
    const assertedAt = data.updated_at ?? data.created_at ?? null;
    const by = `member:${owner ?? 'team'}`;
    nodes.push(makeNode({
      id: nid, kind: type, memory: MEMORY_OF_ARTIFACT[type], title: data.title ?? id,
      status: data.status ?? null, owner, tags: Array.isArray(data.tags) ? data.tags : [],
      created_at: data.created_at, updated_at: data.updated_at,
      as_of: statSync(path).mtime.toISOString(), source: rel,
      meta: {
        area: data.area ?? null, priority: data.priority ?? null, iteration: data.iteration ?? null,
        due_date: data.due_date ?? null, x_kind: data.x_kind ?? null,
        ...(data.x_procedure_graph ? { x_procedure_graph: data.x_procedure_graph } : {}),
      },
    }));

    const relationTargets = new Set();
    for (const r of Array.isArray(data.relations) ? data.relations : []) {
      const raw = typeof r === 'string' ? { type: 'links_to', target: r } : r;
      if (!raw?.target) continue;
      const target = String(raw.target).replace(/^mgmt:/, '');
      const norm = normalizeRel(raw.type ?? 'links_to');
      if (norm.unknown) report.unknownRelations.push({ id: nid, rel: norm.rel, target });
      if (norm.migratedFrom) report.migratedRelations.push({ id: nid, from: norm.migratedFrom, to: norm.rel, target });
      const dst = `mgmt:${target}`;
      relationTargets.add(dst);
      const [s, d] = norm.invert ? [dst, nid] : [nid, dst];
      edges.push(makeEdge({ src: s, rel: norm.rel, dst: d, asserted_by: by, asserted_at: assertedAt, origin: 'frontmatter' }));
    }

    const mentioned = new Set();
    for (const t of [...extractWikiLinks(body), ...extractMarkdownLinkStems(body)]) {
      const target = t.replace(/^mgmt:/, '');
      if (!isArtifactId(target)) continue;
      const dst = `mgmt:${target}`;
      if (dst === nid || relationTargets.has(dst) || mentioned.has(dst)) continue;
      mentioned.add(dst);
      edges.push(makeEdge({ src: nid, rel: 'mentions', dst, asserted_by: by, asserted_at: assertedAt, strength: 'heuristic_signal', origin: 'wikilink' }));
    }

    for (const s of Array.isArray(data.sources) ? data.sources : []) {
      const mem = /workspace\/([a-z0-9-]+)\/memory\/([^/\s]+)\.md$/.exec(String(s?.ref ?? ''));
      if (mem) {
        edges.push(makeEdge({ src: nid, rel: 'evidenced_by', dst: `mem:${mem[1]}/${mem[2]}`, asserted_by: by, asserted_at: assertedAt, origin: 'sources' }));
        continue;
      }
      if (s?.kind !== 'paper') continue;
      const m = /arxiv:\s*(\d{4}\.\d{4,5})(v\d+)?/i.exec(String(s.ref ?? ''));
      if (!m) continue;
      const sid = `src:arxiv:${m[1]}`;
      if (!seen.has(sid)) {
        seen.set(sid, rel);
        nodes.push(makeNode({ id: sid, kind: 'paper', memory: 'episodic', title: s.title ?? s.ref, source: rel, meta: { ref: s.ref } }));
      }
      edges.push(makeEdge({ src: nid, rel: 'evidenced_by', dst: sid, asserted_by: by, asserted_at: assertedAt, origin: 'sources' }));
    }

    if (data.x_procedure_graph && type === 'playbook') {
      procedureGraphs.push({ playbookId: nid, owner, assertedAt, graph: data.x_procedure_graph });
    }
  }

  for (const pg of procedureGraphs) {
    const r = projectProcedureGraph(pg);
    if (r.errors.length) { report.procedureErrors.push(...r.errors); continue; }
    nodes.push(...r.nodes);
    edges.push(...r.edges);
  }
  return { nodes, edges };
}
