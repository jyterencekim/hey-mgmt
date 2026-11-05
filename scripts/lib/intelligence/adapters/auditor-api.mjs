// Pull the auditor's promoted protocol-knowledge facts from its public HTTP API
// and write them as graph-exchange/v0 JSONL into imports/auditor.jsonl.
//
// Identity mapping (mgmt decision_adr-kg-v2-operating-decisions D3 + addendum):
//   producer protocol_knowledge_strict_promotion_gate -> system:auditor (pipeline with its own gate; native strength kept)
//   producer fisher_agent_formalizer                  -> agent:fisher, strength heuristic_signal (source-asserted context only)
// Evidence with `linked_artifact` / `knowledge_id` becomes evidenced_by edges to mgmt:/ext: nodes — the join
// between the auditor's what-is graph and the team's artifacts.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_URL = 'https://auditor.superearn.io';

export async function fetchFacts({ baseUrl = DEFAULT_URL, pageSize = 1000, fetchImpl = fetch } = {}) {
  // The facts route caps at `limit` and ignores `offset`, so we widen coverage by
  // slicing on source_family and then predicate; every slice is deduped by fact_row_id.
  const all = new Map();
  const get = async (params) => {
    const u = new URL('/api/protocol-knowledge/facts', baseUrl);
    u.searchParams.set('limit', String(pageSize));
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const res = await fetchImpl(u);
    if (!res.ok) throw new Error(`auditor facts ${u}: HTTP ${res.status}`);
    const facts = (await res.json()).facts ?? [];
    for (const f of facts) all.set(f.fact_row_id, f);
    return facts;
  };
  const base = await get({});
  if (base.length < pageSize) return [...all.values()];
  const families = [...new Set(base.map((f) => f.source_family).filter(Boolean))];
  for (const fam of families) {
    const page = await get({ source_family: fam });
    if (page.length < pageSize) continue;
    const predicates = [...new Set(page.map((f) => f.predicate))];
    for (const pred of predicates) await get({ source_family: fam, predicate: pred });
  }
  return [...all.values()];
}

const strengthOf = (s) => (['routing_hint', 'source_asserted', 'verifier_confirmed', 'heuristic_signal'].includes(s) ? s : 'source_asserted');

/** Convert facts to exchange records. Returns { records, stats }. */
export function factsToExchange(facts, { fetchedAt = new Date().toISOString() } = {}) {
  const nodes = new Map();
  const edges = [];
  const evEdges = [];
  const stats = { facts: facts.length, by_producer: {}, linked_artifacts: 0, knowledge_links: 0, research_docs: 0, superseded: 0 };
  const node = (o, asOf) => {
    const id = `auditor:${o.object_id}`;
    const prev = nodes.get(id);
    if (!prev || (asOf && (!prev.as_of || asOf > prev.as_of))) {
      nodes.set(id, { record: 'node', id, kind: o.object_kind ?? 'object', memory: 'semantic', title: o.object_id, as_of: asOf ?? null, source: 'auditor:/api/protocol-knowledge/facts', meta: { cadence_seconds: 86400, fetched_at: fetchedAt } });
    }
    return id;
  };
  for (const f of facts) {
    stats.by_producer[f.producer] = (stats.by_producer[f.producer] ?? 0) + 1;
    const asOf = f.recorded_at ?? f.observed_at ?? null;
    const src = node(f.subject, asOf);
    const dst = node(f.object, asOf);
    const isAgent = f.producer === 'fisher_agent_formalizer';
    const by = isAgent ? 'agent:fisher' : 'system:auditor';
    const strength = isAgent ? 'heuristic_signal' : strengthOf(f.assertion_strength);
    const evidence = (f.evidence ?? []).map((e) => e.source_uri ?? `auditor:source_record:${e.source_record_id}`);
    if (f.supersedes_fact_row_id) stats.superseded++;
    edges.push({
      record: 'edge', src, rel: `auditor:${f.predicate}`, dst,
      attrs: { fact_row_id: f.fact_row_id, logical_fact_id: f.logical_fact_id, source_family: f.source_family, method: f.method, evidence_quality: f.evidence_quality, caveats: f.caveats ?? [], object_value: f.object_value ?? {} },
      asserted_by: by, asserted_at: (f.recorded_at ?? '').slice(0, 10) || null, evidence, strength, status: 'accepted',
      supersedes: f.supersedes_fact_row_id ?? null, origin: 'auditor_api',
    });
    for (const e of f.evidence ?? []) {
      const targets = [];
      if (e.linked_artifact) { targets.push(`mgmt:${String(e.linked_artifact).replace(/\.md$/, '')}`); stats.linked_artifacts++; }
      if (e.knowledge_id) { targets.push(`ext:${e.knowledge_id}`); stats.knowledge_links++; }
      const oa = /^onchain-analysis:(.+?)\.md$/.exec(String(e.source_uri ?? ''));   // only markdown documents are doc nodes (html/json artifacts are not)
      if (oa) { targets.push(`oa:doc:${oa[1]}`); stats.research_docs++; }
      for (const t of targets) evEdges.push({ record: 'edge', src, rel: 'evidenced_by', dst: t, attrs: { fact_row_id: f.fact_row_id }, asserted_by: by, asserted_at: (f.recorded_at ?? '').slice(0, 10) || null, evidence: e.source_uri ? [e.source_uri] : [], strength: 'heuristic_signal', status: 'accepted', origin: 'auditor_api_evidence' });
    }
  }
  const dedupe = new Map();
  for (const e of [...edges, ...evEdges]) { const k = `${e.src}|${e.rel}|${e.dst}`; if (!dedupe.has(k)) dedupe.set(k, e); }
  stats.nodes = nodes.size; stats.edges = dedupe.size;
  return { records: [...nodes.values(), ...dedupe.values()], stats };
}

export async function importAuditor({ outPath, ...opts }) {
  const facts = await fetchFacts(opts);
  const { records, stats } = factsToExchange(facts);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return stats;
}
