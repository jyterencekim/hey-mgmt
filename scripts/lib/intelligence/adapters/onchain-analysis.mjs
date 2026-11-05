// superearn-io/onchain-analysis research corpus -> oa: nodes.
//
// Nodes:  oa:doc:<path-without-.md>   one per markdown document (kind by top-level dir)
//         oa:strategy:S-NNN            one per row of strategies/catalog.md
// Edges:  doc -mentions-> doc          from frontmatter `related:` and relative markdown links
//         doc -mentions-> strategy     when the path or H1 names an S-NNN id
//         doc -mentions-> auditor venue when frontmatter `protocol:` matches an auditor market_venue id
// The auditor's protocol-knowledge facts cite these documents as evidence
// (`onchain-analysis:<path>`); src/adapters/auditor-api.mjs turns those into
// `evidenced_by` edges onto the oa: nodes, which is the join between research and facts.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { makeNode, makeEdge, dateStr } from '../lib/model.mjs';

const SKIP = new Set(['node_modules', 'dist', '.git', 'test', 'src', 'scripts']);
const KIND_BY_DIR = {
  insights: ['insight', 'episodic'],
  strategies: ['strategy_doc', 'semantic'],
  risk: ['risk_assessment', 'semantic'],
  knowledge_base: ['kb', 'semantic'],
  whale_tracking: ['whale_report', 'episodic'],
  sessions: ['session', 'episodic'],
  reports: ['report', 'episodic'],
  exports: ['report', 'episodic'],
};
const STRATEGY_ID = /\bS-?(\d{3})\b/i;
const BY = 'agent:onchain-analysis';

export function* walkDocs(dir, root = dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walkDocs(p, root); }
    else if (e.isFile() && e.name.endsWith('.md') && !(dir === root && /^(README|CLAUDE|AGENTS)\.md$/.test(e.name))) yield p;
  }
}

/** old path -> current path for renamed markdown files, following chains; empty when not a git checkout. */
export function gitRenames(root) {
  const map = new Map();
  try {
    const out = execFileSync('git', ['log', '--diff-filter=R', '--name-status', '--format=', '--', '*.md'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    for (const line of out.split('\n')) { const m = /^R\d*\t(.+)\t(.+)$/.exec(line); if (m && !map.has(m[1])) map.set(m[1], m[2]); }
  } catch { /* no git */ }
  const follow = (p) => { let cur = p; for (let i = 0; i < 5 && map.has(cur); i++) cur = map.get(cur); return cur; };
  return new Map([...map.keys()].map((k) => [k, follow(k)]));
}

/** path -> last commit date (YYYY-MM-DD) in one git call; empty map when not a git checkout. */
export function gitDates(root) {
  const map = new Map();
  try {
    const out = execFileSync('git', ['log', '--format=%cs', '--name-only', '--', '*.md'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
    let d = null;
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(line)) d = line;
      else if (!map.has(line)) map.set(line, d);
    }
  } catch { /* not a git checkout: fall back to mtime */ }
  return map;
}

const docId = (rel) => `oa:doc:${rel.replace(/\.md$/, '')}`;
const norm = (s) => String(s ?? '').toLowerCase().trim();

function parseCatalog(root) {
  const p = join(root, 'strategies', 'catalog.md');
  if (!existsSync(p)) return [];
  const rows = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = /^\|\s*(S-\d{3})\s*\|(.+)$/.exec(line);
    if (!m) continue;
    const cells = m[2].split('|').map((c) => c.trim());
    rows.push({ id: m[1], name: cells[0], protocols: cells[1], risk: cells[2], apy: cells[3], delta_neutral: cells[4], viability: cells[5], status: cells[6] });
  }
  return rows;
}

/**
 * @param {string} root      onchain-analysis checkout
 * @param {object} report
 * @param {Set<string>} venueIds  auditor market_venue node ids (for protocol joins), may be empty
 */
export function loadOnchainAnalysis(root, report, venueIds = new Set()) {
  const nodes = [];
  const edges = [];
  if (!root || !existsSync(root)) return { nodes, edges };
  const dates = gitDates(root);
  const aliases = gitRenames(root);
  const docs = [];
  const ids = new Set();

  for (const path of walkDocs(root)) {
    const rel = relative(root, path);
    let data = {}; let body = '';
    try { ({ data, content: body } = matter(readFileSync(path, 'utf8'))); }
    catch (err) { report.parseErrors.push({ path: `onchain-analysis:${rel}`, error: String(err.message) }); continue; }
    const top = rel.split('/')[0];
    const [kind, memory] = KIND_BY_DIR[top] ?? ['doc', 'semantic'];
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const dated = dateStr(data.last_verified ?? data.date ?? data.updated ?? null);
    const asOf = dated ? dated.slice(0, 10) : (dates.get(rel) ?? statSync(path).mtime.toISOString().slice(0, 10));
    const id = docId(rel);
    ids.add(id);
    nodes.push(makeNode({
      id, kind, memory, title: h1 ?? basename(rel, '.md'), status: data.status ? norm(data.status) : null,
      tags: Array.isArray(data.tags) ? data.tags : [], updated_at: asOf, as_of: `${asOf}T00:00:00Z`,
      source: `onchain-analysis:${rel}`,
      meta: { protocol: data.protocol ?? null, chain: data.chain ?? null, risk_level: data.risk_level ?? null, yield_range: data.yield_range ?? null, score: data.score ?? null, framework: data.framework ?? null, cadence_seconds: 120 * 86400 },
    }));
    docs.push({ id, rel, data, body, h1 });
  }

  const catalog = parseCatalog(root);
  const stratIds = new Set();
  for (const r of catalog) {
    const id = `oa:strategy:${r.id}`;
    stratIds.add(r.id.toUpperCase());
    nodes.push(makeNode({ id, kind: 'strategy', memory: 'semantic', title: `${r.id} ${r.name}`, status: norm(r.status) || null, source: 'onchain-analysis:strategies/catalog.md', meta: { protocols: r.protocols, risk: r.risk, apy: r.apy, delta_neutral: r.delta_neutral, viability: r.viability } }));
  }

  for (const d of docs) {
    const targets = new Set();
    const link = (dst, origin) => {
      if (!dst || dst === d.id || targets.has(dst)) return;
      targets.add(dst);
      edges.push(makeEdge({ src: d.id, rel: 'mentions', dst, asserted_by: BY, asserted_at: dateStr(d.data.last_verified)?.slice(0, 10) ?? null, strength: 'heuristic_signal', origin }));
    };
    for (const r of Array.isArray(d.data.related) ? d.data.related : []) {
      const raw = String(r).replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (raw.endsWith('/') || !raw.endsWith('.md')) continue;           // directory pointers and non-markdown targets are not doc nodes
      link(docId(aliases.get(raw) ?? raw), 'oa_related');
    }
    for (const m of d.body.matchAll(/\]\(((?!https?:)[^)\s#]+?)\.md(?:#[^)]*)?\)/g)) {
      const target = relative(root, resolve(dirname(join(root, d.rel)), `${m[1]}.md`));
      if (target.startsWith('..') || /^(README|CLAUDE|AGENTS)\.md$/.test(target)) continue;   // outside the corpus, or the root guides (not doc nodes)
      link(docId(aliases.get(target) ?? target), 'oa_mdlink');
    }
    const sm = STRATEGY_ID.exec(d.rel) ?? STRATEGY_ID.exec(d.h1 ?? '');
    if (sm) { const sid = `S-${sm[1]}`; if (stratIds.has(sid)) link(`oa:strategy:${sid}`, 'oa_strategy_id'); }
    for (const p of String(d.data.protocol ?? '').split(/[,/]/).map(norm).filter(Boolean)) {
      const candidates = [p, p.replace(/-v\d+$/, ''), p.replace(/-/g, '_')];
      for (const c of candidates) { const vid = `auditor:market_venue:${c}`; if (venueIds.has(vid)) { link(vid, 'oa_protocol'); break; } }
    }
  }
  return { nodes, edges, aliases, stats: { docs: docs.length, strategies: catalog.length } };
}
