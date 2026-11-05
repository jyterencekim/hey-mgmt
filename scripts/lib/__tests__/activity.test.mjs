import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestActivityFile, getActivityCandidates, approveActivityCandidate } from '../activity-runner.mjs';
import { finalizeAgentDecisions, finalizeReflectionDecisions, prepareCandidatesForAgent } from '../activity-candidates.mjs';
import { loadExternalActivityConfig } from '../activity-config.mjs';
import { loadMergedKnowledgeEntries, updateKnowledgeEntryStatus } from '../activity-state.mjs';

let tmpRoot;

function write(path, content) {
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function setupRepo() {
  tmpRoot = resolve(tmpdir(), `activity-${Date.now()}`);
  mkdirSync(resolve(tmpRoot, 'content', 'tasks', '2026', '03'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'content', 'decisions'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'content', 'vocab'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'content', 'policies'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'jared'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'fisher', 'observations'), { recursive: true });
  mkdirSync(resolve(tmpRoot, 'workspace', 'fisher', 'knowledge'), { recursive: true });

  write(resolve(tmpRoot, 'content', 'vocab', 'members.yml'), `members:\n  - name: jared\n    role: pm\n  - name: terence\n    role: backend\n`);
  write(resolve(tmpRoot, 'content', 'vocab', 'areas.yml'), `areas:\n  - name: SuperearnCore\n`);
  write(resolve(tmpRoot, 'content', 'vocab', 'tags.yml'), `tags: []\n`);
  write(resolve(tmpRoot, 'content', 'vocab', 'entities.yml'), `entities: []\n`);
  write(resolve(tmpRoot, 'content', 'policies', 'governance.yml'), `sources_policy:\n  decision:\n    min_refs: 2\n`);

  write(resolve(tmpRoot, 'content', 'tasks', '2026', '03', 'task_oracle-fallback.md'), `---
id: task_oracle-fallback
type: task
title: Oracle fallback
created_at: 2026-03-13
updated_at: 2026-03-13
status: ready
owner: jared
area: SuperearnCore
priority: plan
iteration: 2026-W11
definition_of_done:
  - Ship fallback
x_external_refs:
  - jira:SUPER-321
---

## Context
Track the external system signal.

## Definition of Done
- [ ] Ship fallback
`);

  write(resolve(tmpRoot, 'content', 'decisions', 'decision_oracle-policy.md'), `---
id: decision_oracle-policy
type: decision
title: Oracle policy
created_at: 2026-03-13
updated_at: 2026-03-13
decision_status: accepted
owners:
  - jared
  - terence
area: SuperearnCore
sources:
  - kind: doc
    ref: docs/references/oracle-policy.md
    title: Oracle policy
  - kind: doc
    ref: docs/references/oracle-policy-review.md
    title: Oracle policy review
x_external_refs:
  - confluence:149783426
---

## Context
Keep oracle policy aligned with the latest external docs.
`);
}

function makeAgentEvent(source, signature) {
  return {
    source,
    object_type: source === 'slack' ? 'slack-message' : `${source}-document`,
    object_id: `${source}-object-1`,
    object_title: `${source} duplicate replay check`,
    object_url: `https://example.com/${source}/object-1`,
    actor: 'Jared',
    workspace_owner: 'jared',
    changed_at: '2026-03-13T09:15:00+09:00',
    kst_date: '2026-03-13',
    summary: `${source} replay should only be processed once`,
    signature,
    raw_ref: null,
  };
}

describe('external activity workflow', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('ingests events into workspace logs without creating candidates (agent decides)', async () => {
    const fixturePath = resolve(tmpRoot, 'events.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'jira',
        object_type: 'issue',
        object_id: 'SUPER-321',
        object_title: 'SUPER-321 Oracle fallback',
        object_url: 'https://jira.example/SUPER-321',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T09:15:00+09:00',
        native_change_id: 'chg-1',
        summary: 'Status changed to in_progress',
        content_hint: { status: 'in_progress' }
      }
    ], null, 2), 'utf8');

    const result = await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.event_count, 1);
    assert.equal(result.candidate_count, 0);

    const logRaw = readFileSync(resolve(tmpRoot, 'workspace', 'jared', 'logs', '2026-03-13.md'), 'utf8');
    assert.ok(logRaw.includes('## External Signals'));
    assert.ok(logRaw.includes('SUPER-321 Oracle fallback'));

    // No candidates created by ingest — agent pipeline handles all classification
    assert.equal(getActivityCandidates({ repoRoot: tmpRoot, status: 'open' }).length, 0);
  });

  it('coalesces multiple events for the same object and day into one log item', async () => {
    const fixturePath = resolve(tmpRoot, 'events.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'jira',
        object_type: 'issue',
        object_id: 'SUPER-321',
        object_title: 'SUPER-321 Oracle fallback',
        object_url: 'https://jira.example/SUPER-321',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T09:15:00+09:00',
        native_change_id: 'chg-1',
        summary: 'Status changed to in_progress'
      },
      {
        source: 'jira',
        object_type: 'issue',
        object_id: 'SUPER-321',
        object_title: 'SUPER-321 Oracle fallback',
        object_url: 'https://jira.example/SUPER-321',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T11:40:00+09:00',
        native_change_id: 'chg-2',
        summary: 'Comment added'
      }
    ], null, 2), 'utf8');

    await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    const logRaw = readFileSync(resolve(tmpRoot, 'workspace', 'jared', 'logs', '2026-03-13.md'), 'utf8');
    assert.equal(logRaw.split('SUPER-321 Oracle fallback').length - 1, 1);
    assert.ok(logRaw.includes('Status changed to in_progress; Comment added'));
  });

  it('multiple ingests for same artifact produce no candidates (agent decides)', async () => {
    const firstFixture = resolve(tmpRoot, 'events-first.json');
    writeFileSync(firstFixture, JSON.stringify([
      {
        source: 'jira',
        object_type: 'issue',
        object_id: 'SUPER-321',
        object_title: 'SUPER-321 Oracle fallback',
        object_url: 'https://jira.example/SUPER-321',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T09:15:00+09:00',
        native_change_id: 'chg-1',
        summary: 'Status changed to in_progress',
        content_hint: { status: 'in_progress' }
      }
    ], null, 2), 'utf8');
    await ingestActivityFile({ repoRoot: tmpRoot, filePath: firstFixture });
    assert.equal(getActivityCandidates({ repoRoot: tmpRoot, status: 'open' }).length, 0);
  });

  it('does not create candidates for unmatched events (agent handles classification)', async () => {
    const fixturePath = resolve(tmpRoot, 'events-unmatched.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'drive',
        object_type: 'google-doc',
        object_id: 'doc-777',
        object_title: 'Bridge rollout draft',
        object_url: 'https://drive.example/doc-777',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T10:00:00+09:00',
        native_change_id: 'chg-77',
        summary: 'Draft updated'
      }
    ], null, 2), 'utf8');

    const result = await await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.candidate_count, 0);
    assert.equal(getActivityCandidates({ repoRoot: tmpRoot, status: 'open' }).length, 0);
  });

  it('does not auto-distill unmatched docs (agent handles classification)', async () => {
    const rawRef = resolve(tmpRoot, '.runtime', 'drive-collector', 'files', 'doc-888.txt');
    mkdirSync(resolve(rawRef, '..'), { recursive: true });
    writeFileSync(rawRef, `Launch policy review

- Decision: ship the rollout in phases.
- Owner: Jared
- Next step: document the external dependencies.
- Rationale: legal review is complete and partner approvals are in place.
`, 'utf8');

    const fixturePath = resolve(tmpRoot, 'events-distill.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'drive',
        object_type: 'google-doc',
        object_id: 'doc-888',
        object_title: 'Launch policy review',
        object_url: 'https://drive.example/doc-888',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T10:30:00+09:00',
        native_change_id: 'chg-88',
        summary: 'Decision draft updated',
        raw_ref: rawRef
      }
    ], null, 2), 'utf8');

    const result = await await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.candidate_count, 0);
    assert.equal(getActivityCandidates({ repoRoot: tmpRoot, status: 'open' }).length, 0);
  });

  it('ingest writes event history and logs without creating candidates', async () => {
    const fixturePath = resolve(tmpRoot, 'events-decision.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'confluence',
        object_type: 'page',
        object_id: '149783426',
        object_title: 'Oracle policy page',
        object_url: 'https://confluence.example/149783426',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T15:00:00+09:00',
        native_change_id: 'chg-decision-1',
        summary: 'Decision page updated'
      }
    ], null, 2), 'utf8');

    const result = await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.event_count, 1);
    assert.equal(result.candidate_count, 0);
  });

  it('applies a content_update candidate created via agent finalize path', async () => {
    const config = loadExternalActivityConfig(tmpRoot);

    // Agent creates a content_update candidate for task_oracle-fallback
    finalizeAgentDecisions({ repoRoot: tmpRoot, config, decisions: [{
      event_signatures: ['test-sig-approve'],
      decision: 'match',
      artifact_id: 'task_oracle-fallback',
      confidence: 0.95,
      match_reason: 'Exact topic match: Oracle fallback',
      _event_data: {
        source: 'jira', object_id: 'SUPER-321', object_type: 'issue',
        object_title: 'SUPER-321 Oracle fallback', object_url: 'https://jira.example/SUPER-321',
        kst_date: '2026-03-13', signature: 'test-sig-approve',
        summary: 'Status changed to done', changed_at: '2026-03-13T09:15:00+09:00',
        content_hint: { status: 'done' },
      },
    }] });

    const [candidate] = getActivityCandidates({ repoRoot: tmpRoot, status: 'open' });
    assert.ok(candidate);
    const applied = approveActivityCandidate({ repoRoot: tmpRoot, candidateId: candidate.id });
    assert.equal(applied.status, 'applied');

    const artifactRaw = readFileSync(resolve(tmpRoot, 'content', 'tasks', '2026', '03', 'task_oracle-fallback.md'), 'utf8');
    assert.ok(artifactRaw.includes('## External Signals'));
  });

  it('approves a distill review candidate created by the agent finalize path', () => {
    // Simulate the agent pipeline: finalize-candidates creates a distill_review,
    // then approve materializes it into canonical content.
    const config = loadExternalActivityConfig(tmpRoot);

    const rawRef = resolve(tmpRoot, '.runtime', 'confluence-collector', 'files', '149783999.txt');
    mkdirSync(resolve(rawRef, '..'), { recursive: true });
    writeFileSync(rawRef, `Bridge rollout checklist

How to execute the rollout:
1. Confirm the partner launch window.
2. Update the bridge monitoring thresholds.
3. Notify support with the runbook.

Troubleshooting:
- If the bridge queue spikes, pause the launch and notify the incident channel.
`, 'utf8');

    finalizeAgentDecisions({ repoRoot: tmpRoot, config, decisions: [{
      event_signatures: ['test-sig-distill'],
      decision: 'distill',
      artifact_type: 'playbook',
      domain_tag: 'operations',
      title: 'Bridge rollout checklist',
      summary_points: ['Confirm partner launch window', 'Update bridge monitoring thresholds'],
      confidence: 0.9,
      _event_data: {
        source: 'confluence', object_id: '149783999', object_type: 'page',
        object_title: 'Bridge rollout checklist', object_url: 'https://confluence.example/149783999',
        kst_date: '2026-03-13', signature: 'test-sig-distill', raw_ref: rawRef,
      },
      _source_text: readFileSync(rawRef, 'utf8'),
    }] });

    const candidate = getActivityCandidates({ repoRoot: tmpRoot, status: 'open' })
      .find((entry) => entry.candidate_type === 'distill_review');
    assert.ok(candidate, 'distill_review candidate should exist');
    const applied = approveActivityCandidate({ repoRoot: tmpRoot, candidateId: candidate.id });

    assert.equal(applied.status, 'applied');
    assert.ok(applied.artifact_id);
    assert.ok(applied.artifact_path);
  });

  it('keeps low-signal slack messages in the signal lane without opening review candidates', async () => {
    const rawRef = resolve(tmpRoot, '.runtime', 'slack-collector', 'raw', 'messages', 'msg-1.json');
    mkdirSync(resolve(rawRef, '..'), { recursive: true });
    writeFileSync(rawRef, JSON.stringify({ message: { text: 'ok' } }, null, 2), 'utf8');

    const fixturePath = resolve(tmpRoot, 'events-slack-low-signal.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'slack',
        object_type: 'slack-message',
        object_id: 'message__C1__1_1',
        object_title: '#team ok',
        object_url: 'https://slack.example/message',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T17:00:00+09:00',
        native_change_id: 'chg-slack-1',
        summary: 'Slack message in #team: ok',
        raw_ref: rawRef
      }
    ], null, 2), 'utf8');

    const result = await await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.candidate_count, 0);
    assert.equal(getActivityCandidates({ repoRoot: tmpRoot, status: 'open' }).length, 0);
  });

  it('unmatched events produce no candidates via ingest (agent pipeline handles them)', async () => {
    const fixturePath = resolve(tmpRoot, 'events-unmatched-approve.json');
    writeFileSync(fixturePath, JSON.stringify([
      {
        source: 'drive',
        object_type: 'pdf',
        object_id: 'pdf-1',
        object_title: 'Risk review',
        object_url: 'https://drive.example/pdf-1',
        actor: 'Jared',
        workspace_owner: 'jared',
        changed_at: '2026-03-13T16:00:00+09:00',
        native_change_id: 'chg-pdf-1',
        summary: 'Uploaded new PDF'
      }
    ], null, 2), 'utf8');

    const result = await await ingestActivityFile({ repoRoot: tmpRoot, filePath: fixturePath });
    assert.equal(result.candidate_count, 0);
  });

  it('does not re-prepare or re-finalize processed Slack, Drive, and Confluence signatures', () => {
    const config = loadExternalActivityConfig(tmpRoot);
    config.reflection = { promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 };

    for (const source of ['slack', 'drive', 'confluence']) {
      const event = makeAgentEvent(source, `sig-${source}-replay`);

      const firstPrepare = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [event, event] });
      assert.equal(firstPrepare.needs_agent_decision.length, 1, `${source} should be prepared once per signature`);

      const secondPrepare = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [event] });
      assert.equal(secondPrepare.needs_agent_decision.length, 0, `${source} prepared replay should be suppressed`);

      const decision = {
        event_signatures: [event.signature],
        decision: 'skip',
        reflection: 'filter',
        confidence: 0.3,
        skip_reason: `${source} low-signal replay fixture`,
        _event_data: event,
      };
      const firstFinalize = finalizeReflectionDecisions({ repoRoot: tmpRoot, config, decisions: [decision, decision] });
      assert.equal(firstFinalize.filtered, 1, `${source} first finalize should process`);
      assert.equal(firstFinalize.skipped_replayed_signatures, 1);

      const secondFinalize = finalizeReflectionDecisions({ repoRoot: tmpRoot, config, decisions: [decision] });
      assert.equal(secondFinalize.filtered, 0, `${source} finalized replay should be suppressed`);
      assert.equal(secondFinalize.skipped_replayed_signatures, 1);

      const afterFinalizePrepare = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [event] });
      assert.equal(afterFinalizePrepare.needs_agent_decision.length, 0, `${source} finalized signature should not be re-prepared`);
    }

    const rows = readFileSync(resolve(tmpRoot, 'workspace/fisher/knowledge/2026-03.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(rows.length, 3, 'each source should write one durable knowledge row despite prepare/finalize replays');
  });
});

describe('updateKnowledgeEntryStatus revoke', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('revokes a linked entry: clears linked_artifact and reduces relevance_score', () => {
    const knowledgeDir = resolve(tmpRoot, 'workspace', 'fisher', 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });

    const linkedScore = 0.84; // e.g. computeRelevanceScore('match', 1.0) * 1.2 = 0.6 * 1.2 = 0.72, using arbitrary boosted value
    const entry = {
      id: 'kn_test01',
      source: 'jira',
      object_id: 'SUPER-100',
      object_type: 'issue',
      title: 'Test entry',
      summary: 'A test knowledge entry',
      url: 'https://jira.example/SUPER-100',
      actors: ['Jared'],
      workspace_owner: 'jared',
      date: '2026-03-13',
      changed_at: '2026-03-13T09:00:00+09:00',
      topics: [],
      classification: 'match',
      status: 'linked',
      linked_artifact: 'task_test',
      agent_reason: 'test reason',
      relevance_score: linkedScore,
      signature: 'sig-revoke-test',
    };

    writeFileSync(resolve(knowledgeDir, '2026-03.jsonl'), JSON.stringify(entry) + '\n', 'utf8');

    updateKnowledgeEntryStatus(tmpRoot, 'sig-revoke-test', 'revoked', null);

    const lines = readFileSync(resolve(knowledgeDir, '2026-03.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2);

    const updated = JSON.parse(lines.at(-1));

    assert.equal(updated.status, 'revoked');
    assert.equal(updated.linked_artifact, null);
    assert.ok(updated.relevance_score < linkedScore, `expected score < ${linkedScore}, got ${updated.relevance_score}`);

    const [merged] = loadMergedKnowledgeEntries(tmpRoot);
    assert.equal(merged.status, 'revoked');
    assert.equal(merged.linked_artifact, null);
    assert.ok(merged.relevance_score < linkedScore, `expected score < ${linkedScore}, got ${merged.relevance_score}`);
  });
});

describe('finalizeReflectionDecisions', () => {
  beforeEach(setupRepo);
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('routes decisions through reflection gate', async () => {
    const config = loadExternalActivityConfig(tmpRoot);
    // Add reflection config
    config.reflection = { promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 };

    const result = finalizeReflectionDecisions({
      repoRoot: tmpRoot,
      config,
      decisions: [
        {
          decision: 'match',
          confidence: 0.6,
          artifact_id: 'task_oracle-fallback',
          event_signatures: ['test_sig_obs'],
          _event_data: { source: 'slack', object_id: 'MSG1', kst_date: '2026-04-08', object_title: 'Test', object_url: 'http://example.com', summary: 'test' },
          match_reason: 'partial',
          update_draft: { has_new_info: false, section: '', content: '', summary: '' },
        },
        {
          decision: 'skip',
          confidence: 0.95,
          event_signatures: ['test_sig_skip'],
          _event_data: { source: 'slack', object_id: 'MSG2', kst_date: '2026-04-08', object_title: 'Noise', object_url: 'http://example.com', summary: 'noise' },
          skip_reason: 'irrelevant',
        },
      ],
    });
    assert.equal(result.observed, 1);
    assert.equal(result.filtered, 1);
    assert.equal(typeof result.promoted, 'number');
  });

  it('writes promoted reflection knowledge with the linked artifact id', async () => {
    const config = loadExternalActivityConfig(tmpRoot);
    config.reflection = { promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 };

    const result = finalizeReflectionDecisions({
      repoRoot: tmpRoot,
      config,
      decisions: [{
        decision: 'match',
        confidence: 0.95,
        artifact_id: 'task_oracle-fallback',
        event_signatures: ['test_sig_promoted'],
        _event_data: {
          source: 'slack',
          object_id: 'MSG-PROMOTED',
          object_type: 'slack-message',
          object_title: 'Oracle fallback launch note',
          object_url: 'http://example.com/promoted',
          actor: 'Jared',
          workspace_owner: 'jared',
          changed_at: '2026-04-08T09:00:00+09:00',
          kst_date: '2026-04-08',
          signature: 'test_sig_promoted',
          summary: 'The team confirmed the oracle fallback launch note.',
        },
        match_reason: 'high-signal topic match',
        update_draft: { has_new_info: false, section: '', content: '', summary: '' },
      }],
    });

    assert.equal(result.promoted, 1);
    const obsRaw = readFileSync(resolve(tmpRoot, 'workspace/fisher/observations/2026-04-08.md'), 'utf8');
    assert.ok(obsRaw.includes('**Promoted_to**: task_oracle-fallback'));

    const row = JSON.parse(readFileSync(resolve(tmpRoot, 'workspace/fisher/knowledge/2026-04.jsonl'), 'utf8').trim());
    assert.equal(row.status, 'linked');
    assert.equal(row.linked_artifact, 'task_oracle-fallback');
    assert.equal(row.title, 'Oracle fallback launch note');
  });

  it('promotes distill reflections using raw_ref metadata from event history', async () => {
    const config = loadExternalActivityConfig(tmpRoot);
    config.reflection = { promotion_confidence_threshold: 0.8, observation_confidence_threshold: 0.5 };

    const rawRef = resolve(tmpRoot, '.runtime/drive-collector/files/drive-doc.txt');
    write(rawRef, 'Raw source text used only for the provenance mirror.');
    write(resolve(tmpRoot, '.hey/external-activity/events.jsonl'), JSON.stringify({
      source: 'drive',
      object_id: 'DRIVE-DOC-1',
      object_type: 'drive-file',
      object_title: 'Drive doc with useful notes',
      object_url: 'https://docs.example/drive-doc-1',
      actor: 'Jared',
      workspace_owner: 'jared',
      changed_at: '2026-04-09T09:00:00+09:00',
      kst_date: '2026-04-09',
      signature: 'test_sig_distill_promoted',
      raw_ref: rawRef,
      summary: 'A useful Drive document should become a note.',
    }) + '\n');

    const result = finalizeReflectionDecisions({
      repoRoot: tmpRoot,
      config,
      decisions: [{
        decision: 'distill',
        reflection: 'promote',
        confidence: 0.95,
        event_signatures: ['test_sig_distill_promoted'],
        artifact_type: 'note',
        domain_tag: 'general',
        title: 'Drive distill promotion test',
        summary_points: ['Useful Drive document captured as a note.'],
        _source_text: '## Context\n\nClean distilled body from the agent.\n',
      }],
    });

    assert.equal(result.promoted, 1);
    assert.equal(result.observed, 0);

    const obsRaw = readFileSync(resolve(tmpRoot, 'workspace/fisher/observations/2026-04-09.md'), 'utf8');
    assert.ok(obsRaw.includes('**Promoted_to**: note_drive-distill-promotion-test'));

    const row = JSON.parse(readFileSync(resolve(tmpRoot, 'workspace/fisher/knowledge/2026-04.jsonl'), 'utf8').trim());
    assert.equal(row.status, 'linked');
    assert.equal(row.linked_artifact, 'note_drive-distill-promotion-test');
    assert.equal(row.title, 'Drive doc with useful notes');

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const artifactRaw = readFileSync(resolve(tmpRoot, 'content/notes/general', String(yyyy), mm, 'note_drive-distill-promotion-test.md'), 'utf8');
    assert.ok(artifactRaw.includes('Clean distilled body from the agent.'));
  });

  it('adds one-hop KG neighbors while preserving keyword candidates', () => {
    const kgPath = resolve(tmpRoot, '.kg/graph.sqlite');
    mkdirSync(resolve(kgPath, '..'), { recursive: true });
    const db = new DatabaseSync(kgPath);
    db.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, title TEXT, status TEXT, owner TEXT, area TEXT);
      CREATE TABLE edges (src TEXT, rel TEXT, dst TEXT, status TEXT);
      INSERT INTO nodes VALUES
        ('mgmt:task_oracle-fallback', 'task', 'Oracle fallback', 'ready', 'jared', 'SuperearnCore'),
        ('mgmt:initiative_oracle', 'initiative', 'Oracle reliability initiative', 'doing', 'terence', 'SuperearnCore'),
        ('auditor:strategy:oracle', 'strategy', 'Oracle fallback strategy', 'active', NULL, 'Auditor');
      INSERT INTO edges VALUES
        ('mgmt:initiative_oracle', 'parent_of', 'mgmt:task_oracle-fallback', 'accepted'),
        ('mgmt:task_oracle-fallback', 'supports', 'auditor:strategy:oracle', 'heuristic_signal');`);
    db.close();

    const config = loadExternalActivityConfig(tmpRoot);
    config.matching.kg_path = kgPath;
    const event = { ...makeAgentEvent('slack', 'kg-neighbor'), object_title: 'Oracle fallback update', summary: 'Oracle fallback progress' };
    const result = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [event] });
    const candidates = result.needs_agent_decision[0].search_candidates;
    assert.ok(candidates.some((c) => c.id === 'initiative_oracle' && c.kg_relation === 'parent_of'));
    assert.ok(candidates.some((c) => c.id === 'auditor:strategy:oracle' && c.kg_edge_status === 'heuristic_signal'));
  });

  it('falls back to keyword candidates when the KG is missing or unreadable', () => {
    const config = loadExternalActivityConfig(tmpRoot);
    config.matching.kg_path = resolve(tmpRoot, '.kg/missing.sqlite');
    const event = { ...makeAgentEvent('slack', 'kg-missing'), object_title: 'Oracle fallback update', summary: 'Oracle fallback progress' };
    const missing = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [event] });
    assert.ok(missing.needs_agent_decision[0].search_candidates.some((c) => c.id === 'task_oracle-fallback'));

    const brokenPath = resolve(tmpRoot, '.kg/broken.sqlite');
    mkdirSync(resolve(brokenPath, '..'), { recursive: true });
    writeFileSync(brokenPath, 'not a sqlite database', 'utf8');
    config.matching.kg_path = brokenPath;
    const broken = prepareCandidatesForAgent({ repoRoot: tmpRoot, config, events: [{ ...event, signature: 'kg-broken' }] });
    assert.ok(broken.needs_agent_decision[0].search_candidates.some((c) => c.id === 'task_oracle-fallback'));
  });
});
