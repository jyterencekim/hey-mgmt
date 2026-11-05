// Proposal lane for procedural graphs (mgmt decision_adr-kg-v2-operating-decisions D2/D3).
//
// A proposal is a YAML file under workspace/<owner>/proposals/ in mgmt:
//   schema: procedure-proposal/v0
//   id: <slug>                       (defaults to file stem)
//   playbook: playbook_x
//   proposed_by: agent:x | member:x
//   proposed_at: YYYY-MM-DD
//   rationale: why (which trajectories failed / succeeded)
//   edits: { add_nodes: [], delete_nodes: [], add_edges: [], delete_edges: [{src,dst}] }
//   status: proposed | accepted | rejected
//   decision: { gate: metric|owner, by: member:x, at, reason, score?, baseline? }
//
// Edits follow the paper's edit interface: delete before add; delete_edges removes
// every relation between the pair; attribute revision = delete + re-add.
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import YAML from 'yaml';
import matter from 'gray-matter';
import { validateProcedureGraph } from './procedure.mjs';

export const PROPOSAL_SCHEMA = 'procedure-proposal/v0';

export function applyEdits(graph, edits = {}) {
  const g = structuredClone(graph ?? { schema: 'procedural-graph/v0', nodes: [], edges: [] });
  const delNodes = new Set(edits.delete_nodes ?? []);
  const delPairs = new Set((edits.delete_edges ?? []).map((e) => `${e.src}|${e.dst}`));
  g.nodes = (g.nodes ?? []).filter((n) => !delNodes.has(n.id));
  g.edges = (g.edges ?? []).filter((e) => !delNodes.has(e.src) && !delNodes.has(e.dst) && !delPairs.has(`${e.src}|${e.dst}`));
  for (const n of edits.add_nodes ?? []) {
    if (g.nodes.some((x) => x.id === n.id)) throw new Error(`add_nodes: ${n.id} already exists (delete it first to revise)`);
    g.nodes.push({ ...n });
  }
  for (const e of edits.add_edges ?? []) g.edges.push({ ...e });
  return g;
}

export function loadProposals(mgmtRoot) {
  const out = [];
  const ws = join(mgmtRoot, 'workspace');
  if (!existsSync(ws)) return out;
  for (const owner of readdirSync(ws, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const dir = join(ws, owner, 'proposals');
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.yml') || x.endsWith('.yaml')).sort()) {
      const path = join(dir, f);
      try {
        const p = YAML.parse(readFileSync(path, 'utf8')) ?? {};
        out.push({ ...p, id: p.id ?? basename(f).replace(/\.ya?ml$/, ''), path, rel_path: relative(mgmtRoot, path), owner_dir: owner });
      } catch (err) {
        out.push({ id: basename(f), path, rel_path: relative(mgmtRoot, path), owner_dir: owner, error: String(err.message) });
      }
    }
  }
  return out;
}

export function findPlaybook(mgmtRoot, playbookId) {
  const id = playbookId.replace(/^mgmt:/, '');
  const dir = join(mgmtRoot, 'content', 'playbooks');
  const direct = join(dir, `${id}.md`);
  if (existsSync(direct)) return direct;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    const { data } = matter(readFileSync(join(dir, f), 'utf8'));
    if (data.id === id) return join(dir, f);
  }
  return null;
}

export function readPlaybookGraph(path) {
  const { data } = matter(readFileSync(path, 'utf8'));
  return { data, graph: data.x_procedure_graph ?? null };
}

/** Structural check of a proposal against its playbook. Returns { errors, candidate }. */
export function checkProposal(proposal, graph) {
  const errors = [];
  if (proposal.schema !== PROPOSAL_SCHEMA) errors.push(`schema must be ${PROPOSAL_SCHEMA}`);
  if (!proposal.playbook) errors.push('playbook required');
  if (!/^(member|agent):[a-z0-9_-]+$/.test(String(proposal.proposed_by ?? ''))) errors.push('proposed_by must be member:<name> or agent:<name>');
  if (!proposal.rationale || !String(proposal.rationale).trim()) errors.push('rationale required (which trajectories motivated the edit)');
  const edits = proposal.edits ?? {};
  const n = ['add_nodes', 'delete_nodes', 'add_edges', 'delete_edges'].reduce((s, k) => s + (edits[k]?.length ?? 0), 0);
  if (n === 0) errors.push('edits are empty');
  let candidate = null;
  if (!errors.length) {
    try {
      candidate = applyEdits(graph, edits);
      errors.push(...validateProcedureGraph(candidate, proposal.playbook));
    } catch (err) {
      errors.push(String(err.message));
    }
  }
  return { errors, candidate };
}

/**
 * Gate decision. Metric gate: score >= baseline (ties accepted, paper eq. 5).
 * Owner gate: reviewer must be a member. Returns the decision record.
 */
export function decide({ accept, reviewer, reason, score, baseline, gate }) {
  if (!/^member:[a-z0-9_-]+$/.test(String(reviewer ?? ''))) throw new Error('gate decisions require a member:<name> reviewer (D3)');
  const at = new Date().toISOString().slice(0, 10);
  const kind = gate ?? (score != null ? 'metric' : 'owner');
  if (kind === 'metric') {
    if (score == null || baseline == null) throw new Error('metric gate needs --score and --baseline');
    const pass = Number(score) >= Number(baseline);
    if (accept && !pass) throw new Error(`metric gate refuses acceptance: score ${score} < baseline ${baseline}`);
    return { gate: 'metric', by: reviewer, at, reason: reason ?? (pass ? 'score >= baseline' : 'score < baseline'), score: Number(score), baseline: Number(baseline), outcome: accept ? 'accepted' : 'rejected' };
  }
  if (!reason || !String(reason).trim()) throw new Error('owner gate needs --reason');
  return { gate: 'owner', by: reviewer, at, reason, outcome: accept ? 'accepted' : 'rejected' };
}

/** Write the accepted candidate graph back into the playbook frontmatter (the one write to a source repo). */
export function writePlaybookGraph(path, candidate, { bumpDate = true } = {}) {
  const raw = readFileSync(path, 'utf8');
  const parsed = matter(raw);
  const data = { ...parsed.data, x_procedure_graph: candidate };
  if (bumpDate) data.updated_at = new Date().toISOString().slice(0, 10);
  writeFileSync(path, matter.stringify(parsed.content, data, { lineWidth: 0 }));
}

export function writeProposal(proposal) {
  const { path, rel_path, owner_dir, error, ...body } = proposal;
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, YAML.stringify(body, { lineWidth: 0 }));
}

/** Refiner context in the paper's shape: current graph + rejected proposals as negative evidence. */
export function refineContext(playbookId, graph, proposals) {
  const mine = proposals.filter((p) => p.playbook === playbookId.replace(/^mgmt:/, ''));
  const rejected = mine.filter((p) => p.status === 'rejected');
  const pending = mine.filter((p) => p.status === 'proposed');
  const lines = [
    `Playbook: ${playbookId}`,
    'Current Procedural Graph (JSON):',
    JSON.stringify(graph, null, 2),
    '',
    `Previously rejected candidates (${rejected.length}) — do not re-propose equivalent edits:`,
  ];
  for (const p of rejected) {
    lines.push(`- ${p.id} by ${p.proposed_by} on ${p.proposed_at}: ${p.rationale}`);
    lines.push(`  edits: ${JSON.stringify(p.edits)}`);
    lines.push(`  rejected by ${p.decision?.by} (${p.decision?.gate}): ${p.decision?.reason}${p.decision?.score != null ? ` [score ${p.decision.score} < baseline ${p.decision.baseline}]` : ''}`);
  }
  if (pending.length) {
    lines.push('', `Pending proposals (${pending.length}):`);
    for (const p of pending) lines.push(`- ${p.id} by ${p.proposed_by}: ${p.rationale}`);
  }
  lines.push('', 'Output format: a single JSON object with add_nodes, delete_nodes, add_edges, delete_edges. Every added edge MUST carry guidance; action nodes MUST name a tool; every node MUST reach a terminal node.');
  return lines.join('\n');
}

/** edge_events rows derived from proposal files (one per proposal with a decision, plus one per pending proposal). */
export function proposalEvents(proposals) {
  return proposals.filter((p) => !p.error).map((p) => ({
    proposal_id: p.id,
    playbook: `mgmt:${p.playbook}`,
    status: p.status ?? 'proposed',
    proposed_by: p.proposed_by,
    proposed_at: p.proposed_at ?? null,
    decided_by: p.decision?.by ?? null,
    decided_at: p.decision?.at ?? null,
    gate: p.decision?.gate ?? null,
    reason: p.decision?.reason ?? null,
    score: p.decision?.score ?? null,
    baseline: p.decision?.baseline ?? null,
    edits_json: JSON.stringify(p.edits ?? {}),
    source: p.rel_path,
  }));
}
