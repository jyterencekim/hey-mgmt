#!/usr/bin/env node
// scripts/kg.mjs — build, query, and export the unified TeamOS knowledge-graph projection.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { build } from './lib/intelligence/lib/build.mjs';
import {
  openDb, getNode, backlinks, children, neighborhood, path as findPath, isolated, report as dbReport, search,
  procedureGraphs, edgeEvents,
} from './lib/intelligence/lib/query.mjs';
import { serializeGuidance, validateProcedureGraph } from './lib/intelligence/lib/procedure.mjs';
import { loadMgmt } from './lib/intelligence/adapters/mgmt.mjs';
import { freshnessOf, formatFreshness } from './lib/intelligence/lib/freshness.mjs';
import { locate } from './lib/intelligence/lib/locate.mjs';
import { loadProposals, findPlaybook, readPlaybookGraph, checkProposal, refineContext } from './lib/intelligence/lib/proposals.mjs';
import { importAuditor } from './lib/intelligence/adapters/auditor-api.mjs';
import { exportFromDb } from './lib/intelligence/lib/sanitize.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

export function loadConfig() {
  const configFile = resolve(SCRIPT_DIR, 'lib/intelligence/config/sources.yml');
  const c = existsSync(configFile) ? YAML.parse(readFileSync(configFile, 'utf8')) : {};
  const abs = (p) => resolve(REPO_ROOT, p);
  return {
    mgmtRoot: process.env.KG_MGMT_ROOT ? resolve(process.env.KG_MGMT_ROOT) : abs(c.mgmt ?? '.'),
    importsDir: process.env.KG_IMPORTS_DIR ? resolve(process.env.KG_IMPORTS_DIR) : abs(c.imports ?? './scripts/lib/intelligence/imports'),
    outDir: process.env.KG_OUT ? resolve(process.env.KG_OUT) : abs(c.out ?? './.kg'),
    dbPath: process.env.KG_DB ? resolve(process.env.KG_DB) : abs(c.db ?? './.kg/graph.sqlite'),
    onchainAnalysisRoot: process.env.KG_ONCHAIN_ANALYSIS_ROOT
      ? resolve(process.env.KG_ONCHAIN_ANALYSIS_ROOT)
      : (c.onchain_analysis ? abs(c.onchain_analysis) : null),
  };
}

export function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) opts[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) opts[k] = argv[++i];
      else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

const out = (obj, opts = {}) => console.log(opts.json ? JSON.stringify(obj, null, 2) : typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };

const SOURCE_EXTS = new Set(['.md', '.yml', '.yaml', '.json', '.jsonl']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hey', '.kg', 'dist', '.cache', '.DS_Store',
  'memory', 'inbox', 'logs', 'raw', 'attachments', 'tmp', 'assets', 'exports', 'debug', '.omc'
]);

export function anyFileNewerThan(dir, threshold) {
  if (!existsSync(dir)) return false;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (anyFileNewerThan(full, threshold)) return true;
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0) continue;
      if (!SOURCE_EXTS.has(entry.name.slice(dot))) continue;
      if (statSync(full).mtimeMs > threshold) return true;
    }
  }
  return false;
}

export function graphNeedsBuild(cfg) {
  if (!existsSync(cfg.dbPath)) return true;
  const dbMtime = statSync(cfg.dbPath).mtimeMs;
  const checkDirs = [
    join(cfg.mgmtRoot, 'content'),
    join(cfg.mgmtRoot, 'workspace'),
    cfg.importsDir,
  ];
  if (cfg.onchainAnalysisRoot && existsSync(cfg.onchainAnalysisRoot)) {
    checkDirs.push(cfg.onchainAnalysisRoot);
  }
  for (const dir of checkDirs) {
    if (anyFileNewerThan(dir, dbMtime)) return true;
  }
  return false;
}

export function getDb(cfg, opts = {}) {
  const skipRebuild = Boolean(opts['no-rebuild'] || opts.noRebuild);
  const exists = existsSync(cfg.dbPath);
  if (!exists && skipRebuild) {
    fail(`no projection at ${cfg.dbPath}; run: ./hey graph build`, 2);
  }
  if (!exists || (!skipRebuild && graphNeedsBuild(cfg))) {
    const label = !exists ? 'initializing' : 'auto-rebuilding';
    console.error(`[graph] ${label} projection from updated source artifacts...`);
    build(cfg);
  }
  return openDb(cfg.dbPath);
}

const withFresh = (n) => (n ? { ...n, freshness: freshnessOf(n) } : n);
const fmtEdge = (e) => `${e.src} -${e.rel}${e.derived ? '*' : ''}-> ${e.dst}${e.attrs?.guidance ? `  [${e.attrs.guidance}]` : ''}`;

export const HELP = `hey graph <command> [args]  (or: node scripts/kg.mjs <command>)

Projection
  build                              rebuild .kg/graph.sqlite and .kg/graph.jsonl
  stats                              headline numbers and metrics
  validate                           adapter-level problems in the sources (exit 1 on hard errors)
  import-auditor [--url U]           pull protocol-knowledge facts from the auditor API into imports/auditor.jsonl
  export [--scope public|all] [--format jsonl|json|sqlite] [--out path]
                                     export sanitized or complete graph

Query (add --json for machine output; nodes carry a freshness verdict)
  node <id>                          one node
  search <term> [--limit n]
  neighborhood <id> [--hops 2] [--rel a,b] [--dir out|in|both] [--derived]
  backlinks <id>                     incoming edges grouped by relation (* = derived reciprocal)
  children <id>                      parent_of targets
  path <from> <to>                   shortest undirected path over authored edges
  isolated [--ns mgmt]               nodes with no authored edge

Procedures (Lu et al. 2026)
  guidance <playbook> [--at node] [--hops 2]          2-hop guidance text from a playbook's x_procedure_graph
  guidance --tool "<last tool call>" [--hops 2]        locate the active node across all playbooks, then guide
  locate --tool "<last tool call>"                     which playbook/node matches
  propose <proposal.yml>                               structural check of an edit set against its playbook
  proposals [playbook]                                 list proposals and decisions (edge_events)
  refine-context <playbook>                            refiner input: current graph + rejected proposals

Ids are namespaced: mgmt:task_x, mem:charlie/feedback_x, ext:kn_…, proc:<playbook>/<node>, auditor:<kind>:<id>, oa:doc:<path>, oa:strategy:S-NNN, src:arxiv:….`;

export async function runKg(argv) {
  const { pos, opts } = parseArgs(argv);
  const [cmd, ...args] = pos;
  const cfg = loadConfig();

  switch (cmd) {
    case 'build': {
      const r = build(cfg);
      const s = r.stats;
      console.log(`built ${s.nodes} nodes, ${s.edges_authored} authored + ${s.edges_derived} derived edges -> ${cfg.dbPath}`);
      console.log(`isolated ${s.isolated_nodes} (${(s.isolated_share * 100).toFixed(1)}%), untyped links_to share ${(s.untyped_share * 100).toFixed(1)}%, dangling ${s.dangling_edges}, migrated ${s.migrated_relations}, unknown rel ${s.unknown_relations}, procedure errors ${s.procedure_errors}, identity violations ${s.identity_violations}, proposals ${JSON.stringify(s.proposals)}`);
      break;
    }
    case 'stats': {
      const db = getDb(cfg, opts);
      const rep = dbReport(db);
      out(rep?.stats ?? { error: 'no report in build_meta' }, { json: true });
      break;
    }
    case 'export': {
      const db = getDb(cfg, opts);
      const scope = opts.scope || 'public';
      const format = opts.format || 'jsonl';
      const outPath = opts.out ? resolve(opts.out) : resolve(REPO_ROOT, `dist/export-graph-${scope}.${format}`);
      const includeNamespaces = opts.ns ? opts.ns.split(',').map((s) => s.trim()) : null;
      const { stats } = exportFromDb(db, {
        scope,
        format,
        out: outPath,
        includeNamespaces,
      });
      console.log(`Exported knowledge graph to ${outPath}`);
      console.log(`Scope: ${stats.scope}, Format: ${stats.format}`);
      console.log(`Nodes: ${stats.exported_nodes} / ${stats.total_nodes} (filtered ${stats.excluded_nodes})`);
      console.log(`Edges: ${stats.exported_edges} / ${stats.total_edges} (filtered ${stats.excluded_edges})`);
      break;
    }
    case 'validate': {
      const { report } = (await import('./lib/intelligence/lib/build.mjs')).assemble(cfg);
      const hard = report.parseErrors.length + report.procedureErrors.length;
      const warn = report.unknownRelations.length + report.dangling.length + report.identityViolations.length;
      out({ hard_errors: hard, warnings: warn, ...report }, { json: true });
      if (hard > 0) process.exit(1);
      break;
    }
    case 'import-auditor': {
      const outPath = resolve(cfg.importsDir, 'auditor.jsonl');
      const stats = await importAuditor({ outPath, baseUrl: opts.url });
      console.log(`imported ${stats.facts} facts (${stats.nodes} nodes, ${stats.edges} edges, ${stats.linked_artifacts} linked artifacts) -> ${outPath}`);
      break;
    }
    case 'node': {
      const id = args[0];
      if (!id) fail('usage: hey graph node <id>');
      const db = getDb(cfg, opts);
      const n = getNode(db, id);
      if (!n) fail(`node not found: ${id}`);
      out(withFresh(n), opts);
      break;
    }
    case 'search': {
      const term = args[0];
      if (!term) fail('usage: hey graph search <term>');
      const db = getDb(cfg, opts);
      const limit = Number(opts.limit ?? 20);
      out(search(db, term, limit), { json: true });
      break;
    }
    case 'neighborhood': {
      const id = args[0];
      if (!id) fail('usage: hey graph neighborhood <id>');
      const db = getDb(cfg, opts);
      const hops = Number(opts.hops ?? 2);
      const rels = opts.rel ? opts.rel.split(',').map((s) => s.trim()) : null;
      const direction = opts.dir ?? 'out';
      const includeDerived = Boolean(opts.derived);
      const r = neighborhood(db, id, { hops, rels, direction, includeDerived });
      if (opts.json) { out(r, { json: true }); break; }
      if (r.missing) { console.log(`node not found: ${id}`); break; }
      for (const e of r.edges) console.log(`[hop ${e.hop}] ${fmtEdge(e)}`);
      const nodes = Object.values(r.nodes).map(withFresh);
      const stale = nodes.filter((n) => n?.freshness?.verdict === 'stale');
      console.log(`\n${nodes.length} nodes, ${r.edges.length} edges; ${stale.length ? `⚠ ${stale.length} stale: ${stale.map((n) => n.id).join(', ')}` : 'all fresh'}`);
      break;
    }
    case 'backlinks': {
      const id = args[0];
      if (!id) fail('usage: hey graph backlinks <id>');
      const db = getDb(cfg, opts);
      const grouped = backlinks(db, id);
      if (opts.json) { out(grouped, { json: true }); break; }
      const rels = Object.keys(grouped).sort();
      if (!rels.length) { console.log(`no backlinks to ${id}`); break; }
      for (const rel of rels) {
        console.log(`${rel} (${grouped[rel].length})`);
        for (const e of grouped[rel]) console.log(`  ${e.src}  — ${e.src_title}`);
      }
      break;
    }
    case 'children': {
      const id = args[0];
      if (!id) fail('usage: hey graph children <id>');
      const db = getDb(cfg, opts);
      const ch = children(db, id);
      if (opts.json) { out(ch, { json: true }); break; }
      if (!ch.length) { console.log(`no children for ${id}`); break; }
      for (const c of ch) console.log(`- [${c.kind}] ${c.id}: ${c.title}${c.status ? ` (${c.status})` : ''}`);
      break;
    }
    case 'path': {
      const [from, to] = args;
      if (!from || !to) fail('usage: hey graph path <from> <to>');
      const db = getDb(cfg, opts);
      const p = findPath(db, from, to);
      if (opts.json) { out(p, { json: true }); break; }
      if (p === null) { console.log('no path'); break; }
      if (!p.length) { console.log('same node'); break; }
      for (const e of p) console.log(`${e.src} -${e.rel}-> ${e.dst}`);
      break;
    }
    case 'isolated': {
      const db = getDb(cfg, opts);
      const ns = opts.ns ?? null;
      const list = isolated(db, ns);
      if (opts.json) { out(list, { json: true }); break; }
      console.log(`isolated nodes (${list.length}${ns ? ` in ${ns}` : ''}):`);
      for (const n of list) console.log(`  ${n.id}  [${n.kind}]  ${n.title}`);
      break;
    }
    case 'locate': {
      const tool = opts.tool;
      if (!tool) fail('usage: hey graph locate --tool "<last tool call>"');
      const db = getDb(cfg, opts);
      const graphs = procedureGraphs(db);
      out(locate(graphs, tool), { json: true });
      break;
    }
    case 'guidance': {
      const db = getDb(cfg, opts);
      const hops = Number(opts.hops ?? 2);
      let targetPlaybook = args[0];
      let atNode = (opts.at && opts.at !== true) ? String(opts.at) : null;

      if (opts.tool) {
        const graphs = procedureGraphs(db);
        const match = locate(graphs, opts.tool);
        if (!match) fail(`no procedure node matches tool call: ${opts.tool}`);
        targetPlaybook = match.playbookId;
        atNode = match.node;
      }
      if (!targetPlaybook) fail('usage: hey graph guidance <playbook> [--at <node>] or --tool "<tool>"');
      const pbNode = getNode(db, targetPlaybook.startsWith('mgmt:') ? targetPlaybook : `mgmt:${targetPlaybook}`);
      if (!pbNode) fail(`playbook node not found: ${targetPlaybook}`);
      const graph = pbNode.meta?.x_procedure_graph;
      if (!graph) fail(`playbook ${targetPlaybook} carries no x_procedure_graph`);
      console.log(serializeGuidance(graph, atNode, hops));
      break;
    }
    case 'propose': {
      const file = args[0];
      if (!file) fail('usage: hey graph propose <proposal.yml>');
      const path = resolve(file);
      if (!existsSync(path)) fail(`file not found: ${path}`);
      const proposal = YAML.parse(readFileSync(path, 'utf8'));
      const playbookPath = findPlaybook(cfg.mgmtRoot, proposal.playbook);
      if (!playbookPath) fail(`playbook not found: ${proposal.playbook}`);
      const { graph } = readPlaybookGraph(playbookPath);
      const { errors, candidate } = checkProposal(proposal, graph);
      if (errors.length) {
        console.error(`proposal INVALID (${errors.length} error(s)):`);
        for (const e of errors) console.error(`  - ${e}`);
        process.exit(1);
      }
      console.log(`proposal VALID against ${proposal.playbook}`);
      console.log(`candidate graph: ${candidate.nodes.length} nodes, ${candidate.edges.length} edges`);
      break;
    }
    case 'proposals': {
      const db = getDb(cfg, opts);
      const pb = args[0] ?? null;
      out(edgeEvents(db, pb), { json: true });
      break;
    }
    case 'refine-context': {
      const pb = args[0];
      if (!pb) fail('usage: hey graph refine-context <playbook>');
      const db = getDb(cfg, opts);
      out(refineContext(db, pb), { json: true });
      break;
    }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`unknown graph command: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

// If invoked directly from CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runKg(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
