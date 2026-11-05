// Build the projection: run adapters, resolve references, derive reciprocals,
// write build/graph.jsonl + build/report.json and .kg/graph.sqlite.
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deriveReciprocals, edgeKey } from './model.mjs';
import { loadMgmt } from '../adapters/mgmt.mjs';
import { loadMemories } from '../adapters/memory.mjs';
import { loadFisherKnowledge } from '../adapters/fisher.mjs';
import { loadExchangeDir } from '../adapters/exchange.mjs';
import { loadOnchainAnalysis } from '../adapters/onchain-analysis.mjs';
import { loadProposals, proposalEvents } from './proposals.mjs';

export function newReport() {
  return {
    built_at: new Date().toISOString(),
    parseErrors: [], unknownTypes: [], idPrefixMismatch: [], duplicateIds: [],
    unknownRelations: [], migratedRelations: [], procedureErrors: [], dangling: [], identityViolations: [],
    stats: null,
  };
}

export function assemble({ mgmtRoot, importsDir, onchainAnalysisRoot = null }) {
  const report = newReport();
  const exchange = loadExchangeDir(importsDir, report);
  const venueIds = new Set(exchange.nodes.filter((n) => n.ns === 'auditor' && n.kind === 'market_venue').map((n) => n.id));
  const oa = loadOnchainAnalysis(onchainAnalysisRoot, report, venueIds);
  const parts = [
    loadMgmt(mgmtRoot, report),
    loadMemories(mgmtRoot, report),
    loadFisherKnowledge(mgmtRoot, report),
    exchange,
    oa,
  ];
  // Citations of research docs that were renamed since the citation was recorded follow the rename.
  const oaAlias = (id) => {
    if (!id.startsWith('oa:doc:') || !oa.aliases) return id;
    const cur = oa.aliases.get(`${id.slice(7)}.md`);
    return cur ? `oa:doc:${cur.replace(/\.md$/, '')}` : id;
  };
  for (const p of parts) for (const e of p.edges) { e.src = oaAlias(e.src); e.dst = oaAlias(e.dst); }
  const nodes = new Map();
  for (const p of parts) for (const n of p.nodes) {
    if (nodes.has(n.id)) report.duplicateIds.push({ id: n.id, path: n.source, first: nodes.get(n.id).source });
    else nodes.set(n.id, n);
  }
  const authored = [];
  const keys = new Set();
  for (const p of parts) for (const e of p.edges) {
    if (!nodes.has(e.src) || !nodes.has(e.dst)) { report.dangling.push({ src: e.src, rel: e.rel, dst: e.dst, origin: e.origin }); continue; }
    // D3 (decision_adr-kg-v2-operating-decisions): an agent may assert proposed edges or
    // heuristic_signal edges, never an accepted source_asserted/verifier_confirmed edge.
    if (e.asserted_by.startsWith('agent:') && e.status === 'accepted' && e.strength !== 'heuristic_signal') {
      report.identityViolations.push({ src: e.src, rel: e.rel, dst: e.dst, asserted_by: e.asserted_by, origin: e.origin });
      continue;
    }
    const k = edgeKey(e);
    if (keys.has(k)) continue;
    keys.add(k);
    authored.push(e);
  }
  const derived = deriveReciprocals(authored);
  const edges = [...authored, ...derived];
  const proposals = loadProposals(mgmtRoot);
  for (const p of proposals) if (p.error) report.parseErrors.push({ path: p.rel_path, error: p.error });
  const events = proposalEvents(proposals);
  report.stats = computeStats([...nodes.values()], authored, derived, report);
  report.stats.proposals = { proposed: events.filter((e) => e.status === 'proposed').length, accepted: events.filter((e) => e.status === 'accepted').length, rejected: events.filter((e) => e.status === 'rejected').length };
  return { nodes: [...nodes.values()], edges, events, report };
}

function computeStats(nodes, authored, derived, report) {
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  const touched = new Set();
  for (const e of authored) { touched.add(e.src); touched.add(e.dst); }
  const isolated = nodes.filter((n) => !touched.has(n.id));
  const linksTo = authored.filter((e) => e.rel === 'links_to').length;
  return {
    nodes: nodes.length,
    nodes_by_ns: count(nodes, (n) => n.ns),
    nodes_by_kind: count(nodes, (n) => `${n.ns}:${n.kind}`),
    nodes_by_memory: count(nodes, (n) => n.memory),
    edges_authored: authored.length,
    edges_derived: derived.length,
    edges_by_rel: count(authored, (e) => e.rel),
    edges_by_origin: count(authored, (e) => e.origin),
    untyped_share: authored.length ? Number((linksTo / authored.length).toFixed(3)) : 0,
    isolated_nodes: isolated.length,
    isolated_share: nodes.length ? Number((isolated.length / nodes.length).toFixed(3)) : 0,
    isolated_by_ns: count(isolated, (n) => n.ns),
    dangling_edges: report.dangling.length,
    migrated_relations: report.migratedRelations.length,
    unknown_relations: report.unknownRelations.length,
    procedure_errors: report.procedureErrors.length,
    identity_violations: report.identityViolations.length,
  };
}

export function writeJsonl(path, nodes, edges) {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [
    ...nodes.map((n) => JSON.stringify({ record: 'node', ...n })),
    ...edges.map((e) => JSON.stringify({ record: 'edge', ...e })),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`);
}

export function writeSqlite(path, nodes, edges, report, events = []) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path);
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE nodes(
      id TEXT PRIMARY KEY, ns TEXT NOT NULL, kind TEXT NOT NULL, memory TEXT NOT NULL,
      title TEXT, status TEXT, owner TEXT, tags_json TEXT, created_at TEXT, updated_at TEXT,
      valid_from TEXT, valid_to TEXT, as_of TEXT, source TEXT, meta_json TEXT
    );
    CREATE TABLE edges(
      src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, attrs_json TEXT,
      asserted_by TEXT NOT NULL, asserted_at TEXT, evidence_json TEXT, strength TEXT NOT NULL,
      status TEXT NOT NULL, supersedes TEXT, derived INTEGER NOT NULL DEFAULT 0, origin TEXT,
      PRIMARY KEY(src, rel, dst),
      FOREIGN KEY(src) REFERENCES nodes(id), FOREIGN KEY(dst) REFERENCES nodes(id)
    );
    CREATE INDEX edges_dst ON edges(dst);
    CREATE INDEX edges_rel ON edges(rel);
    CREATE INDEX nodes_ns_kind ON nodes(ns, kind);
    CREATE TABLE build_meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE edge_events(
      proposal_id TEXT PRIMARY KEY, playbook TEXT NOT NULL, status TEXT NOT NULL, proposed_by TEXT, proposed_at TEXT,
      decided_by TEXT, decided_at TEXT, gate TEXT, reason TEXT, score REAL, baseline REAL, edits_json TEXT, source TEXT
    );
  `);
  const insN = db.prepare(`INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insE = db.prepare(`INSERT INTO edges VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.exec('BEGIN');
  for (const n of nodes) {
    insN.run(n.id, n.ns, n.kind, n.memory, n.title, n.status, n.owner, JSON.stringify(n.tags ?? []),
      n.created_at, n.updated_at, n.valid_from, n.valid_to, n.as_of, n.source, JSON.stringify(n.meta ?? {}));
  }
  for (const e of edges) {
    insE.run(e.src, e.rel, e.dst, JSON.stringify(e.attrs ?? {}), e.asserted_by, e.asserted_at,
      JSON.stringify(e.evidence ?? []), e.strength, e.status, e.supersedes, e.derived ? 1 : 0, e.origin);
  }
  const insEv = db.prepare('INSERT OR REPLACE INTO edge_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const ev of events) insEv.run(ev.proposal_id, ev.playbook, ev.status, ev.proposed_by, ev.proposed_at, ev.decided_by, ev.decided_at, ev.gate, ev.reason, ev.score, ev.baseline, ev.edits_json, ev.source);
  db.prepare('INSERT INTO build_meta VALUES (?,?)').run('report', JSON.stringify(report));
  db.prepare('INSERT INTO build_meta VALUES (?,?)').run('built_at', report.built_at);
  db.exec('COMMIT');
  db.close();
}

export function build({ mgmtRoot, importsDir, outDir, dbPath, onchainAnalysisRoot = null }) {
  const { nodes, edges, events, report } = assemble({ mgmtRoot, importsDir, onchainAnalysisRoot });
  writeJsonl(`${outDir}/graph.jsonl`, nodes, edges);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeSqlite(dbPath, nodes, edges, report, events);
  return report;
}
