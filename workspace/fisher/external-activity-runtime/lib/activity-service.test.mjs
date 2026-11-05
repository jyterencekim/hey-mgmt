import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ActivityApprovalService, MANUAL_LINK_REQUIRED_TEXT } from './activity-service.mjs';

function makeConfig() {
  return {
    bot: {
      approval_poll_seconds: 60,
      delivery_state_path: '.runtime/external-activity-runtime/state.json',
      dm_help_text: 'help',
    },
    members: {
      jared: {
        slack_user_id: 'U07EPER3998',
        slack_dm_id: 'D07E8TSQB1V',
      },
      terence: {
        slack_user_id: 'U098SMD9TBJ',
        slack_dm_id: 'D098Y4RTL9X',
      },
    },
  };
}

function writeMembersVocab(repoRoot, members = ['jared', 'terence', 'oliver']) {
  const vocabDir = resolve(repoRoot, 'content', 'vocab');
  mkdirSync(vocabDir, { recursive: true });
  writeFileSync(
    resolve(vocabDir, 'members.yml'),
    `members:\n${members.map((member) => `  - name: ${member}\n    role: team\n`).join('')}`,
    'utf8',
  );
}

function makeCandidate(overrides = {}) {
  return {
    id: 'candidate_1',
    candidate_type: 'content_update',
    status: 'open',
    artifact_id: 'task_oracle-fallback',
    owner: 'jared',
    approvers: ['jared'],
    matching_policy: 'exact_x_external_refs',
    reference_day: '2026-03-16',
    updated_at: '2026-03-16T00:00:00Z',
    events: [{
      source: 'jira',
      object_title: 'SUPER-321 Oracle fallback',
      object_url: 'https://jira.example/SUPER-321',
      summary: 'Status changed to in_progress',
      kst_date: '2026-03-16',
    }],
    ...overrides,
  };
}

class FakeClient {
  constructor(candidates) {
    this.candidates = candidates;
    this.approved = [];
    this.rejected = [];
  }

  listCandidates() {
    return this.candidates;
  }

  approveCandidate(id) {
    this.approved.push(id);
    return { id, artifact_id: 'task_oracle-fallback', status: 'applied' };
  }

  rejectCandidate(id) {
    this.rejected.push(id);
    return { id, status: 'rejected' };
  }
}

describe('ActivityApprovalService', () => {
  it('posts a new DM for open approvals', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const client = new FakeClient([makeCandidate()]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });
    const webClient = {
      conversations: {
        open: async () => ({ channel: { id: 'D07E8TSQB1V' } }),
      },
      chat: {
        postMessage: async ({ channel }) => ({ channel, ts: '1111.2222' }),
      },
    };

    const deliveries = await service.notifyOpenCandidates(webClient);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].mode, 'post');
  });

  it('updates the previous DM when the candidate changed', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const candidate = makeCandidate();
    const client = new FakeClient([candidate]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });
    const calls = [];
    const webClient = {
      conversations: {
        open: async () => ({ channel: { id: 'D07E8TSQB1V' } }),
      },
      chat: {
        postMessage: async ({ channel }) => ({ channel, ts: '1111.2222' }),
        update: async (payload) => {
          calls.push(payload);
          return payload;
        },
      },
    };

    await service.notifyOpenCandidates(webClient);
    client.candidates[0] = makeCandidate({
      updated_at: '2026-03-16T01:00:00Z',
      events: [{
        source: 'jira',
        object_title: 'SUPER-321 Oracle fallback',
        object_url: 'https://jira.example/SUPER-321',
        summary: 'Comment added',
        kst_date: '2026-03-16',
      }],
    });
    const deliveries = await service.notifyOpenCandidates(webClient);

    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].mode, 'update');
    assert.equal(calls.length, 1);
  });

  it('approves only for an authorized approver', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const client = new FakeClient([makeCandidate()]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });

    const response = await service.handleCandidateAction('candidate_1', 'U07EPER3998', 'approve');

    assert.equal(client.approved.length, 1);
    assert.match(response, /반영 완료/);
  });

  it('allows distill review approval for an authorized approver', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'slack-activity-bot-'));
    const client = new FakeClient([makeCandidate({
      candidate_type: 'distill_review',
      artifact_id: null,
      suggested_artifact: { type: 'note', title: 'Distilled launch note' },
    })]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });

    const response = await service.handleCandidateAction('candidate_1', 'U07EPER3998', 'approve');

    assert.equal(client.approved.length, 1);
    assert.match(response, /반영 완료/);
  });

  it('blocks unmatched mapping approval and returns guidance', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const client = new FakeClient([makeCandidate({ candidate_type: 'unmatched_mapping', artifact_id: null })]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });

    const response = await service.handleCandidateAction('candidate_1', 'U07EPER3998', 'approve');

    assert.equal(client.approved.length, 0);
    assert.equal(response, MANUAL_LINK_REQUIRED_TEXT);
  });

  it('rejects action from a non-approver', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const client = new FakeClient([makeCandidate()]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });

    const response = await service.handleCandidateAction('candidate_1', 'U098SMD9TBJ', 'reject');

    assert.equal(client.rejected.length, 0);
    assert.match(response, /지정된 승인자/);
  });

  it('approves for an inferred unpaired Slack member', async () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    writeMembersVocab(repoRoot);
    const baseConfig = makeConfig();
    const client = new FakeClient([makeCandidate({
      owner: 'oliver',
      approvers: ['oliver'],
    })]);
    const service = new ActivityApprovalService({
      repoRoot,
      config: {
        ...baseConfig,
        members: {
          ...baseConfig.members,
          oliver: {},
        },
      },
      client,
    });
    const webClient = {
      users: {
        info: async () => ({
          user: {
            name: 'oliver.kim',
            profile: {
              display_name: 'Oliver Kim',
              real_name: 'Oliver Kim',
            },
          },
        }),
      },
    };

    const response = await service.handleCandidateAction('candidate_1', 'U0OLIVER999', 'approve', webClient);

    assert.equal(client.approved.length, 1);
    assert.match(response, /반영 완료/);
  });

  it('renders content update notifications with a reject button instead of command hints', () => {
    const repoRoot = mkdtempSync(resolve(tmpdir(), 'external-activity-runtime-'));
    const client = new FakeClient([makeCandidate({
      update_draft: {
        has_new_info: true,
        section: 'Progress',
        summary: 'Oracle fallback progress updated',
        content: '- Updated progress',
      },
    })]);
    const service = new ActivityApprovalService({ repoRoot, config: makeConfig(), client });

    const blocks = service.buildCandidateBlocks(client.candidates[0]);
    const header = blocks.find((block) => block.type === 'section' && block.text?.text?.includes('Content update review'));
    const actions = blocks.find((block) => block.type === 'actions');

    assert.ok(header);
    assert.ok(!blocks.some((block) => block.type === 'context' && block.elements?.some((e) => e.text?.includes('approve '))));
    assert.ok(actions);
    assert.equal(actions.elements[0].action_id, 'fisher_activity_reject_candidate');
    assert.equal(actions.elements[0].text.text, 'Reject');
    assert.ok(actions.elements[0].value.includes('"candidate_id":"candidate_1"'));
  });
});
