// End-to-end use-case scenarios for internal intelligence graph in superearn-mgmt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { assemble, build } from '../intelligence/lib/build.mjs';
import { openDb, procedureGraphs, edgeEvents, getNode } from '../intelligence/lib/query.mjs';
import { serializeGuidance } from '../intelligence/lib/procedure.mjs';
import { locate } from '../intelligence/lib/locate.mjs';
import { loadProposals, findPlaybook, readPlaybookGraph, checkProposal, decide, writePlaybookGraph, writeProposal, refineContext } from '../intelligence/lib/proposals.mjs';
import { factsToExchange } from '../intelligence/adapters/auditor-api.mjs';
import { freshnessOf } from '../intelligence/lib/freshness.mjs';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/mgmt-mini');
const edgeStr = (e) => `${e.src} ${e.rel} ${e.dst}`;

function scratch() {
  const dir = mkdtempSync(resolve(tmpdir(), 'kg-scenario-'));
  const mgmt = join(dir, 'mgmt');
  cpSync(FIXTURE, mgmt, { recursive: true });
  const imports = join(dir, 'imports');
  mkdirSync(imports);
  const dbPath = join(dir, 'graph.sqlite');
  const rebuild = () => { build({ mgmtRoot: mgmt, importsDir: imports, outDir: join(dir, 'build'), dbPath }); return openDb(dbPath); };
  return { dir, mgmt, imports, dbPath, rebuild };
}

test('scenario: an agent mid-run passes its last tool call and gets localized guidance with the pitfall on the next transition', () => {
  const { rebuild } = scratch();
  const db = rebuild();
  const graphs = procedureGraphs(db);
  assert.equal(graphs.length, 1);
  // exact tool match
  const hit = locate(graphs, 'git push');
  assert.deepEqual(hit, { playbookId: 'mgmt:playbook_deploy', node: 'push', score: 1, how: 'exact' });
  // the agent typed a longer command line; prefix match still localizes
  assert.equal(locate(graphs, 'git push origin main --force-with-lease').node, 'push');
  // unrelated call: nothing matches, caller falls back to the full graph
  assert.equal(locate(graphs, 'kubectl rollout restart'), null);
  const text = serializeGuidance(graphs[0].graph, hit.node, 2);
  assert.match(text, /Active Cognitive Node: \[push\]/);
  assert.match(text, /\[push\] → \[end\]\n  \* Guidance: done/);
});

test('scenario: proposal lifecycle — invalid edits never reach the gate, owner rejection becomes refiner negative evidence, metric acceptance rewrites the playbook and shows up as a proc: node and an edge_events row', () => {
  const { mgmt, rebuild } = scratch();
  const pbPath = findPlaybook(mgmt, 'playbook_deploy');
  const { graph: base } = readPlaybookGraph(pbPath);
  const pdir = join(mgmt, 'workspace', 'fisher', 'proposals');
  mkdirSync(pdir, { recursive: true });

  // 1. structurally invalid: adds an action node without a tool and an edge without guidance
  const bad = {
    schema: 'procedure-proposal/v0', playbook: 'playbook_deploy', proposed_by: 'agent:fisher', proposed_at: '2026-09-14', rationale: 'three runs skipped verification', status: 'proposed',
    edits: { add_nodes: [{ id: 'verify', kind: 'action' }], add_edges: [{ src: 'push', rel: 'LEADS_TO', dst: 'verify' }] }
  };
  const r1 = checkProposal(bad, base);
  assert.ok(r1.errors.some((e) => /must name a tool/.test(e)));
  assert.ok(r1.errors.some((e) => /must carry guidance/.test(e)));
  assert.ok(r1.errors.some((e) => /cannot reach a terminal|no terminal/.test(e)) || r1.errors.length >= 2);

  // 2. valid proposal, rejected by the owner with a reason
  const p2 = {
    schema: 'procedure-proposal/v0', playbook: 'playbook_deploy', proposed_by: 'agent:fisher', proposed_at: '2026-09-14', rationale: 'runs that skipped CI failed', status: 'proposed',
    edits: {
      delete_edges: [{ src: 'push', dst: 'end' }], add_nodes: [{ id: 'wait_ci', kind: 'check', tool: 'gh run watch' }],
      add_edges: [{ src: 'push', rel: 'LEADS_TO', dst: 'wait_ci', guidance: 'watch CI before declaring done' }, { src: 'wait_ci', rel: 'LEADS_TO', dst: 'end', guidance: 'done when green', condition: 'CI green' }]
    }
  };
  assert.deepEqual(checkProposal(p2, base).errors, []);
  const d2 = decide({ accept: false, reviewer: 'member:alice', reason: 'CI is already enforced by branch protection; redundant step' });
  assert.equal(d2.outcome, 'rejected');
  writeProposal({ ...p2, path: join(pdir, '2026-09-14-deploy-wait-ci.yml'), status: 'rejected', decision: d2 });
  // an agent cannot be the reviewer
  assert.throws(() => decide({ accept: true, reviewer: 'agent:fisher', reason: 'lgtm' }), /member:<name> reviewer/);

  // refiner context carries the rejection as negative evidence
  const ctx = refineContext('playbook_deploy', base, loadProposals(mgmt));
  assert.match(ctx, /Previously rejected candidates \(1\)/);
  assert.match(ctx, /redundant step/);
  assert.match(ctx, /"add_nodes":\[\{"id":"wait_ci"/);

  // 3. second proposal, metric gate: score below baseline refuses, score at baseline (tie) accepts and writes the playbook
  const p3 = {
    schema: 'procedure-proposal/v0', playbook: 'playbook_deploy', proposed_by: 'agent:fisher', proposed_at: '2026-09-15', rationale: 'successful runs all tagged the release', status: 'proposed',
    edits: {
      delete_edges: [{ src: 'push', dst: 'end' }], add_nodes: [{ id: 'tag_release', kind: 'action', tool: 'git tag' }],
      add_edges: [{ src: 'push', rel: 'LEADS_TO', dst: 'tag_release', guidance: 'tag after push', pitfalls: 'never tag before CI' }, { src: 'tag_release', rel: 'LEADS_TO', dst: 'end', guidance: 'done' }]
    }
  };
  const { errors, candidate } = checkProposal(p3, base);
  assert.deepEqual(errors, []);
  assert.throws(() => decide({ accept: true, reviewer: 'member:alice', score: 0.7, baseline: 0.8 }), /score 0.7 < baseline 0.8/);
  const d3 = decide({ accept: true, reviewer: 'member:alice', score: 0.8, baseline: 0.8 });
  assert.equal(d3.outcome, 'accepted');
  assert.equal(d3.gate, 'metric');
  for (const e of candidate.edges) e.status = 'accepted';
  writePlaybookGraph(pbPath, candidate);
  writeProposal({ ...p3, path: join(pdir, '2026-09-15-deploy-tag-release.yml'), status: 'accepted', decision: d3 });

  // the playbook on disk now carries the new node, other frontmatter intact
  const after = readPlaybookGraph(pbPath);
  assert.ok(after.graph.nodes.some((n) => n.id === 'tag_release'));
  assert.equal(after.data.id, 'playbook_deploy');
  assert.equal(after.data.owner, 'alice');

  // rebuild: proc node exists, its edge carries the pitfall, edge_events has both decisions
  const db = rebuild();
  assert.ok(getNode(db, 'proc:deploy/tag_release'));
  const ev = edgeEvents(db, 'playbook_deploy');
  assert.deepEqual(ev.map((e) => [e.proposal_id, e.status, e.gate, e.decided_by]), [
    ['2026-09-14-deploy-wait-ci', 'rejected', 'owner', 'member:alice'],
    ['2026-09-15-deploy-tag-release', 'accepted', 'metric', 'member:alice'],
  ]);
  assert.equal(ev[1].score, 0.8);
});

test('scenario: auditor facts join the team graph', () => {
  const { mgmt, imports, rebuild } = scratch();
  const facts = [
    {
      fact_row_id: 'r1', logical_fact_id: 'l1', producer: 'protocol_knowledge_strict_promotion_gate', source_family: 'onchain_analysis_research',
      subject: { object_id: 'strategy:pt-usdg', object_kind: 'strategy' }, predicate: 'has_oracle_dependency', object: { object_id: 'oracle:pendle-pt', object_kind: 'oracle' },
      recorded_at: '2026-09-01T00:00:00Z', assertion_strength: 'source_asserted', evidence: [{ source_record_id: 's1', source_uri: 'https://example/doc' }]
    },
    {
      fact_row_id: 'r2', logical_fact_id: 'l2', producer: 'fisher_agent_formalizer', source_family: 'fisher_protocol_fund_flow',
      subject: { object_id: 'protocol_movement:fisher:swap_1', object_kind: 'protocol_movement' }, predicate: 'creates_state', object: { object_id: 'market_observation:swap_1_ctx', object_kind: 'market_observation' },
      recorded_at: '2026-09-02T00:00:00Z', assertion_strength: 'source_asserted', evidence: [{ source_record_id: 's2', knowledge_id: 'kn_1', linked_artifact: 'task_one' }]
    },
  ];
  const { records, stats } = factsToExchange(facts, { fetchedAt: '2026-09-14T00:00:00Z' });
  assert.equal(stats.nodes, 4);
  const e1 = records.find((r) => r.record === 'edge' && r.attrs?.fact_row_id === 'r1' && r.rel.startsWith('auditor:'));
  assert.equal(e1.asserted_by, 'system:auditor');
  assert.equal(e1.strength, 'source_asserted');
  const e2 = records.find((r) => r.record === 'edge' && r.attrs?.fact_row_id === 'r2' && r.rel.startsWith('auditor:'));
  assert.equal(e2.asserted_by, 'agent:fisher');
  assert.equal(e2.strength, 'heuristic_signal');
  writeFileSync(join(imports, 'auditor.jsonl'), records.map((r) => JSON.stringify(r)).join('\n'));
  const { edges, report } = assemble({ mgmtRoot: mgmt, importsDir: imports });
  const authored = edges.filter((e) => !e.derived).map(edgeStr);
  assert.ok(authored.includes('auditor:strategy:pt-usdg auditor:has_oracle_dependency auditor:oracle:pendle-pt'));
  assert.ok(authored.includes('auditor:protocol_movement:fisher:swap_1 evidenced_by mgmt:task_one'));
  assert.ok(authored.includes('auditor:protocol_movement:fisher:swap_1 evidenced_by ext:kn_1'));
  assert.equal(report.identityViolations.length, 0);
  const db = rebuild();
  const n = getNode(db, 'auditor:strategy:pt-usdg');
  assert.equal(n.meta.cadence_seconds, 86400);
});

test('scenario: freshness verdicts', () => {
  const now = Date.parse('2026-09-14T00:00:00Z');
  assert.equal(freshnessOf({ ns: 'ext', as_of: '2026-06-01T00:00:00Z', status: 'indexed' }, now).verdict, 'stale');
  assert.equal(freshnessOf({ ns: 'ext', as_of: '2026-09-12T00:00:00Z' }, now).verdict, 'fresh');
  assert.equal(freshnessOf({ ns: 'mgmt', as_of: '2026-01-01T00:00:00Z', status: 'done' }, now).verdict, 'n/a');
  assert.equal(freshnessOf({ ns: 'mgmt', as_of: '2026-01-01T00:00:00Z', status: 'doing' }, now).verdict, 'stale');
  assert.equal(freshnessOf({ ns: 'mem', as_of: '2026-09-01T00:00:00Z' }, now).verdict, 'fresh');
  assert.equal(freshnessOf({ ns: 'auditor', as_of: '2026-09-10T00:00:00Z', meta: { cadence_seconds: 86400 } }, now).verdict, 'stale');
  assert.equal(freshnessOf({ ns: 'proc', as_of: null }, now).verdict, 'n/a');
  assert.equal(freshnessOf({ ns: 'ext', as_of: null }, now).verdict, 'unknown');
});
