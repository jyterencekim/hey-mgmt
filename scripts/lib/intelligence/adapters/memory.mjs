// workspace/{member}/memory/*.md -> mem:{member}/{file-stem} nodes; wikilinks and
// relative markdown links become `mentions` edges to other memories or to
// mgmt artifacts. Memory files are read as they are (no frontmatter rewrite).
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { makeNode, makeEdge } from '../lib/model.mjs';
import { readMarkdown, extractWikiLinks, extractMarkdownLinkStems, isArtifactId } from '../lib/frontmatter.mjs';

const KINDS = new Set(['feedback', 'project', 'reference', 'user']);
const norm = (s) => String(s).toLowerCase().replace(/\.md$/, '').replace(/[-_]/g, '-');

function kindOf(name, data) {
  const k = data.type ?? data.metadata?.type ?? null;
  if (k && KINDS.has(k)) return k;
  const m = /^(feedback|project|reference|user)[-_]/.exec(name);
  return m ? m[1] : 'reference';
}

export function loadMemories(root, report) {
  const nodes = [];
  const edges = [];
  const wsRoot = join(root, 'workspace');
  if (!existsSync(wsRoot)) return { nodes, edges };

  const members = readdirSync(wsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(wsRoot, d.name, 'memory')))
    .map((d) => d.name);

  for (const member of members) {
    const dir = join(wsRoot, member, 'memory');
    const files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md');
    const parsed = [];
    const byNorm = new Map();
    for (const f of files) {
      const path = join(dir, f);
      const { data, body, error } = readMarkdown(path);
      if (error) { report.parseErrors.push({ path: relative(root, path), error }); continue; }
      const stem = basename(f, '.md');
      const name = data.name ?? stem;
      const id = `mem:${member}/${stem}`;
      byNorm.set(norm(name), id);
      byNorm.set(norm(stem), id);
      parsed.push({ id, name, data, body, path, stem });
    }
    for (const p of parsed) {
      const by = `member:${member}`;
      const assertedAt = statSync(p.path).mtime.toISOString().slice(0, 10);
      nodes.push(makeNode({
        id: p.id, kind: kindOf(p.name, p.data), memory: 'semantic',
        title: p.data.description ?? p.name, owner: member,
        as_of: statSync(p.path).mtime.toISOString(), source: relative(root, p.path),
        meta: { name: p.name, source_repo: p.data.source_repo ?? p.data.metadata?.source_repo ?? null },
      }));
      const targets = new Set();
      for (const t of [...extractWikiLinks(p.body), ...extractMarkdownLinkStems(p.body)]) {
        let dst = null;
        if (isArtifactId(t)) dst = `mgmt:${t}`;
        else if (byNorm.has(norm(t))) dst = byNorm.get(norm(t));
        if (!dst || dst === p.id || targets.has(dst)) continue;
        targets.add(dst);
        edges.push(makeEdge({ src: p.id, rel: 'mentions', dst, asserted_by: by, asserted_at: assertedAt, strength: 'heuristic_signal', origin: 'memory_link' }));
      }
    }
  }
  return { nodes, edges };
}
