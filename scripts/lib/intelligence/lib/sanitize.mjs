// Sanitization and export engine for the TeamOS Knowledge Graph.
// Filters internal/private nodes and ensures 100% referential integrity (zero dangling edges).

import { writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_EXCLUDED_TAGS = [
  'confidential',
  'internalonly',
  'internal-only',
  'private',
  'secret',
  'salary',
  'compensation',
];

export const PUBLIC_ALLOWED_NAMESPACES = new Set([
  'auditor',
  'oa',
  'proc',
  'src',
  'mgmt',
]);

/**
 * Evaluates whether a node should be included under the given scope policy.
 * @param {object} node
 * @param {object} options
 * @returns {boolean}
 */
export function isNodePermitted(node, options = {}) {
  const scope = options.scope || 'public';
  if (scope === 'all') return true;

  const ns = node.ns;
  const kind = node.kind;

  // Custom namespace filter
  if (options.includeNamespaces?.length && !options.includeNamespaces.includes(ns)) {
    return false;
  }
  if (options.excludeNamespaces?.length && options.excludeNamespaces.includes(ns)) {
    return false;
  }

  // Custom kind filter
  if (options.excludeKinds?.length && options.excludeKinds.includes(kind)) {
    return false;
  }

  // Tag filter (case-insensitive check)
  const tags = (node.tags || []).map((t) => String(t).toLowerCase());
  const excludedTags = (options.excludeTags || DEFAULT_EXCLUDED_TAGS).map((t) => t.toLowerCase());
  for (const tag of tags) {
    if (excludedTags.includes(tag)) return false;
  }

  if (scope === 'protocol') {
    return ns === 'auditor' || ns === 'oa' || ns === 'proc';
  }

  if (scope === 'public') {
    // 1. Only allowed namespaces
    if (!PUBLIC_ALLOWED_NAMESPACES.has(ns)) return false;

    // 2. Personal memory and raw external activity are excluded in public scope
    if (ns === 'mem' || ns === 'ext') return false;

    // 3. Exclude internal meetings in public scope
    if (ns === 'mgmt' && kind === 'meeting') return false;

    // 4. Exclude personal workspace artifacts (only content/ is canonical public)
    if (ns === 'mgmt' && node.source && node.source.startsWith('workspace/')) {
      return false;
    }

    return true;
  }

  return true;
}

/**
 * Sanitizes and exports graph nodes and edges.
 * @param {object} params
 * @param {Array<object>} params.nodes
 * @param {Array<object>} params.edges
 * @param {object} [params.options]
 * @returns {{ nodes: Array<object>, edges: Array<object>, stats: object }}
 */
export function sanitizeGraph({ nodes, edges, options = {} }) {
  const allowedNodes = new Map();
  let excludedNodeCount = 0;

  for (const n of nodes) {
    if (isNodePermitted(n, options)) {
      // Optional metadata scrubbing for public release
      const cleanNode = { ...n };
      if (options.scope === 'public' && cleanNode.meta) {
        const meta = { ...cleanNode.meta };
        delete meta.internal_id;
        delete meta.author_email;
        delete meta.slack_url;
        cleanNode.meta = meta;
      }
      allowedNodes.set(cleanNode.id, cleanNode);
    } else {
      excludedNodeCount++;
    }
  }

  // Retain only edges where BOTH endpoints are permitted (zero dangling edges)
  const allowedEdges = [];
  let excludedEdgeCount = 0;

  for (const e of edges) {
    if (allowedNodes.has(e.src) && allowedNodes.has(e.dst)) {
      allowedEdges.push(e);
    } else {
      excludedEdgeCount++;
    }
  }

  const stats = {
    total_nodes: nodes.length,
    exported_nodes: allowedNodes.size,
    excluded_nodes: excludedNodeCount,
    total_edges: edges.length,
    exported_edges: allowedEdges.length,
    excluded_edges: excludedEdgeCount,
    scope: options.scope || 'public',
    format: options.format || 'jsonl',
  };

  return {
    nodes: [...allowedNodes.values()],
    edges: allowedEdges,
    stats,
  };
}

/**
 * Exports the graph to a target file in JSONL, JSON, or SQLite format.
 * @param {object} db DatabaseSync instance over .kg/graph.sqlite
 * @param {object} options
 * @returns {object} export summary stats
 */
export function exportFromDb(db, options = {}) {
  const format = options.format || 'jsonl';
  const outPath = options.out;

  const rawNodes = db.prepare('SELECT * FROM nodes').all().map((r) => ({
    ...r,
    tags: JSON.parse(r.tags_json ?? '[]'),
    meta: JSON.parse(r.meta_json ?? '{}'),
    tags_json: undefined,
    meta_json: undefined,
  }));

  const rawEdges = db.prepare('SELECT * FROM edges WHERE derived = 0').all().map((r) => ({
    ...r,
    attrs: JSON.parse(r.attrs_json ?? '{}'),
    evidence: JSON.parse(r.evidence_json ?? '[]'),
    derived: Boolean(r.derived),
    attrs_json: undefined,
    evidence_json: undefined,
  }));

  const { nodes, edges, stats } = sanitizeGraph({ nodes: rawNodes, edges: rawEdges, options });

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });

    if (format === 'jsonl') {
      const lines = [
        ...nodes.map((n) => JSON.stringify({ record: 'node', ...n })),
        ...edges.map((e) => JSON.stringify({ record: 'edge', ...e })),
      ];
      writeFileSync(outPath, `${lines.join('\n')}\n`);
    } else if (format === 'json') {
      writeFileSync(outPath, JSON.stringify({ stats, nodes, edges }, null, 2) + '\n');
    } else if (format === 'sqlite') {
      if (existsSync(outPath)) rmSync(outPath);
      const exportDb = new DatabaseSync(outPath);
      exportDb.exec(`
        CREATE TABLE nodes(
          id TEXT PRIMARY KEY, ns TEXT NOT NULL, kind TEXT NOT NULL, memory TEXT NOT NULL,
          title TEXT, status TEXT, owner TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
          valid_from TEXT, valid_to TEXT, as_of TEXT, source TEXT, meta_json TEXT
        );
        CREATE TABLE edges(
          src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, attrs_json TEXT,
          asserted_by TEXT NOT NULL, asserted_at TEXT, evidence_json TEXT, strength TEXT NOT NULL,
          status TEXT NOT NULL, supersedes TEXT, derived INTEGER NOT NULL DEFAULT 0, origin TEXT,
          PRIMARY KEY(src, rel, dst)
        );
        CREATE INDEX edges_dst ON edges(dst);
        CREATE INDEX edges_rel ON edges(rel);
        CREATE INDEX nodes_ns_kind ON nodes(ns, kind);
        CREATE TABLE export_meta(key TEXT PRIMARY KEY, value TEXT);
      `);
      const insN = exportDb.prepare('INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
      const insE = exportDb.prepare('INSERT INTO edges VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      exportDb.exec('BEGIN');
      for (const n of nodes) {
        insN.run(n.id, n.ns, n.kind, n.memory, n.title, n.status, n.owner, JSON.stringify(n.tags ?? []),
          n.created_at, n.updated_at, n.valid_from, n.valid_to, n.as_of, n.source, JSON.stringify(n.meta ?? {}));
      }
      for (const e of edges) {
        insE.run(e.src, e.rel, e.dst, JSON.stringify(e.attrs ?? {}), e.asserted_by, e.asserted_at,
          JSON.stringify(e.evidence ?? []), e.strength, e.status, e.supersedes, e.derived ? 1 : 0, e.origin);
      }
      exportDb.prepare('INSERT INTO export_meta VALUES (?,?)').run('stats', JSON.stringify(stats));
      exportDb.prepare('INSERT INTO export_meta VALUES (?,?)').run('exported_at', new Date().toISOString());
      exportDb.exec('COMMIT');
      exportDb.close();
    }
  }

  return { stats, nodes, edges };
}
