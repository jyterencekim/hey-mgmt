// Procedure-graph proposal gate — the ONLY path that writes an accepted edit set
// into a playbook's x_procedure_graph (decision_adr-kg-v2-operating-decisions D2/D3).
//
// The projection repo (superearn-intelligence) is read-only against mgmt; the
// validator and the edit interface live there and are imported from the sibling
// checkout so there is one implementation. Set KG_INTELLIGENCE_ROOT to override
// the sibling path.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

export function intelligenceRoot(repoRoot) {
  if (process.env.KG_INTELLIGENCE_ROOT) {
    const candidate = resolve(process.env.KG_INTELLIGENCE_ROOT);
    if (existsSync(candidate)) return candidate;
  }
  const internal = repoRoot ? resolve(repoRoot, 'scripts/lib/intelligence') : null;
  if (internal && existsSync(resolve(internal, 'lib/proposals.mjs'))) {
    return internal;
  }
  const internalSelf = resolve(import.meta.dirname, 'intelligence');
  if (existsSync(resolve(internalSelf, 'lib/proposals.mjs'))) {
    return internalSelf;
  }
  const sibling = repoRoot ? resolve(repoRoot, '..', 'superearn-intelligence') : null;
  if (sibling && existsSync(resolve(sibling, 'src/lib/proposals.mjs'))) {
    return sibling;
  }
  return internalSelf;
}

async function lib(repoRoot) {
  const root = intelligenceRoot(repoRoot);
  const file = existsSync(resolve(root, 'lib/proposals.mjs'))
    ? resolve(root, 'lib/proposals.mjs')
    : resolve(root, 'src/lib/proposals.mjs');
  return import(pathToFileURL(file).href);
}

function loadProposalFile(file) {
  const path = resolve(file);
  const proposal = YAML.parse(readFileSync(path, 'utf8')) ?? {};
  return { path, proposal };
}

/** Structural check only. Returns { errors, candidate, playbookPath }. */
export async function checkProposalFile(repoRoot, file) {
  const { findPlaybook, readPlaybookGraph, checkProposal } = await lib(repoRoot);
  const { proposal } = loadProposalFile(file);
  const playbookPath = findPlaybook(repoRoot, proposal.playbook ?? '');
  if (!playbookPath) return { errors: [`playbook not found: ${proposal.playbook}`], candidate: null, playbookPath: null };
  const { graph } = readPlaybookGraph(playbookPath);
  const { errors, candidate } = checkProposal(proposal, graph);
  return { errors, candidate, playbookPath, proposal, graph };
}

/**
 * Gate a proposal. On accept, writes the candidate graph into the playbook and
 * records the decision in the proposal file; on reject, records the decision only.
 * Returns { decision, playbookPath, proposalPath }.
 */
export async function gateProposalFile(repoRoot, file, { accept, reviewer, reason, score, baseline, gate } = {}) {
  const { decide, writePlaybookGraph, writeProposal } = await lib(repoRoot);
  const { path: proposalPath, proposal } = loadProposalFile(file);
  if (proposal.status && proposal.status !== 'proposed') throw new Error(`proposal already ${proposal.status}`);
  const checked = await checkProposalFile(repoRoot, file);
  if (checked.errors.length) throw new Error(`structurally invalid, cannot gate:\n${checked.errors.map((e) => `- ${e}`).join('\n')}`);
  const decision = decide({ accept: Boolean(accept), reviewer, reason, score, baseline, gate });
  if (decision.outcome === 'accepted') {
    for (const e of checked.candidate.edges) if (!e.status || e.status === 'proposed') e.status = 'accepted';
    writePlaybookGraph(checked.playbookPath, checked.candidate);
  }
  writeProposal({ ...proposal, path: proposalPath, status: decision.outcome, decision });
  return { decision, playbookPath: checked.playbookPath, proposalPath };
}
