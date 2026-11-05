import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProposalFile, gateProposalFile, intelligenceRoot } from '../procedure-gate.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
// Point to the internal intelligence lib
process.env.KG_INTELLIGENCE_ROOT ??= resolve(REPO_ROOT, 'scripts/lib/intelligence');

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'hey-procedure-'));
  mkdirSync(join(root, 'content/playbooks'), { recursive: true });
  mkdirSync(join(root, 'workspace/fisher/proposals'), { recursive: true });
  writeFileSync(join(root, 'content/playbooks/playbook_deploy.md'), `---
id: playbook_deploy
type: playbook
title: Deploy
owner: alice
playbook_version: "0.1.0"
x_procedure_graph:
  schema: procedural-graph/v0
  nodes:
    - {id: start, kind: start}
    - {id: push, kind: action, tool: git push}
    - {id: end, kind: end}
  edges:
    - {src: start, rel: LEADS_TO, dst: push, guidance: push it}
    - {src: push, rel: LEADS_TO, dst: end, guidance: done}
---
Body stays intact.
`);
  const proposal = join(root, 'workspace/fisher/proposals/2026-09-15-deploy-verify.yml');
  writeFileSync(proposal, `schema: procedure-proposal/v0
playbook: playbook_deploy
proposed_by: agent:fisher
proposed_at: 2026-09-15
rationale: three runs skipped verification
status: proposed
edits:
  delete_edges: [{src: push, dst: end}]
  add_nodes: [{id: verify, kind: check, tool: gh run watch}]
  add_edges:
    - {src: push, rel: LEADS_TO, dst: verify, guidance: watch CI, pitfalls: never skip}
    - {src: verify, rel: LEADS_TO, dst: end, guidance: done when green}
`);
  return { root, proposal };
}

test('the gate lives in mgmt and uses the internal intelligence library for the validator', () => {
  assert.ok(intelligenceRoot(REPO_ROOT).endsWith('intelligence'));
});

test('check is read-only and reports the candidate size', async () => {
  const { root, proposal } = scratchRepo();
  const r = await checkProposalFile(root, proposal);
  assert.deepEqual(r.errors, []);
  assert.equal(r.candidate.nodes.length, 4);
  assert.match(readFileSync(join(root, 'content/playbooks/playbook_deploy.md'), 'utf8'), /- \{src: push, rel: LEADS_TO, dst: end/, 'check must not touch the playbook');
});

test('an agent cannot gate; a member rejecting records the decision without touching the playbook', async () => {
  const { root, proposal } = scratchRepo();
  await assert.rejects(() => gateProposalFile(root, proposal, { accept: true, reviewer: 'agent:fisher', reason: 'lgtm' }), /member:<name> reviewer/);
  const r = await gateProposalFile(root, proposal, { accept: false, reviewer: 'member:alice', reason: 'CI is enforced by branch protection' });
  assert.equal(r.decision.outcome, 'rejected');
  assert.match(readFileSync(proposal, 'utf8'), /status: rejected/);
  assert.match(readFileSync(join(root, 'content/playbooks/playbook_deploy.md'), 'utf8'), /dst: end, guidance: done\}/, 'playbook unchanged on reject');
  await assert.rejects(() => gateProposalFile(root, proposal, { accept: true, reviewer: 'member:alice', reason: 'x' }), /already rejected/);
});

test('a member accepting (metric gate, tie accepted) rewrites only x_procedure_graph and keeps the rest of the playbook', async () => {
  const { root, proposal } = scratchRepo();
  await assert.rejects(() => gateProposalFile(root, proposal, { accept: true, reviewer: 'member:alice', score: 0.7, baseline: 0.8 }), /score 0.7 < baseline 0.8/);
  const r = await gateProposalFile(root, proposal, { accept: true, reviewer: 'member:alice', score: 0.8, baseline: 0.8 });
  assert.equal(r.decision.outcome, 'accepted');
  const pb = readFileSync(join(root, 'content/playbooks/playbook_deploy.md'), 'utf8');
  assert.match(pb, /id: verify/);
  assert.match(pb, /status: accepted/);
  assert.match(pb, /owner: alice/);
  assert.match(pb, /Body stays intact\./);
  assert.match(readFileSync(proposal, 'utf8'), /gate: metric/);
});
