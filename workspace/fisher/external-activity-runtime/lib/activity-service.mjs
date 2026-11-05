import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseInboxCommand } from './inbox-command-parser.mjs';
import { inferMemberKeyFromSlackUser } from './member-resolver.mjs';

export const MANUAL_LINK_REQUIRED_TEXT = [
  '이 후보는 아직 shared artifact와 정확히 연결되지 않았습니다.',
  '`x_external_refs`를 먼저 추가하거나 매핑을 정리한 뒤 다시 반영해주세요.',
].join(' ');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function uniqueOrdered(values) {
  return [...new Set(values.filter(Boolean))];
}

function encodeSlackActionValue(payload) {
  return JSON.stringify(payload);
}

export class HeyActivityClient {
  constructor({ repoRoot, nodeBin = process.env.HEY_MGMT_CONNECTOR_NODE || process.execPath } = {}) {
    this.repoRoot = repoRoot;
    this.nodeBin = nodeBin;
    this.heyScript = resolve(repoRoot, 'scripts', 'hey.mjs');
  }

  run(args) {
    const completed = spawnSync(this.nodeBin, [this.heyScript, ...args], {
      cwd: this.repoRoot,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    });
    const payloadText = completed.stdout?.trim() || completed.stderr?.trim() || '{}';
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (error) {
      throw new Error(`Unexpected hey output: ${payloadText}`);
    }

    if (completed.status !== 0 || payload?.error) {
      throw new Error(payload?.error || `hey ${args.join(' ')} failed`);
    }

    return payload;
  }

  listCandidates(status = 'open') {
    const args = ['activity', 'candidates'];
    if (status) args.push('--status', status);
    const payload = this.run(args);
    return Array.isArray(payload) ? payload : [];
  }

  approveCandidate(candidateId) {
    return this.run(['activity', 'approve', '--id', candidateId]);
  }

  rejectCandidate(candidateId) {
    return this.run(['activity', 'reject', '--id', candidateId]);
  }
}

export class ActivityApprovalService {
  constructor({ repoRoot, config, client = new HeyActivityClient({ repoRoot }) }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.client = client;
    this.statePath = resolve(repoRoot, config.bot.delivery_state_path);
  }

  listOpenCandidates() {
    return this.client.listCandidates('open');
  }

  readState() {
    return readJson(this.statePath, {});
  }

  writeState(state) {
    writeJson(this.statePath, state);
  }

  async memberKeyForSlackUserId(slackUserId, webClient = null) {
    const directMatch = inferMemberKeyFromSlackUser({
      config: this.config,
      repoRoot: this.repoRoot,
      slackUserId,
      user: null,
    });
    if (directMatch) return directMatch;
    if (!webClient?.users?.info || !slackUserId) return null;

    try {
      const payload = await webClient.users.info({ user: slackUserId });
      return inferMemberKeyFromSlackUser({
        config: this.config,
        repoRoot: this.repoRoot,
        slackUserId,
        user: payload.user ?? null,
      });
    } catch {
      return null;
    }
  }

  candidateApprovers(candidate) {
    return uniqueOrdered(Array.isArray(candidate.approvers) ? candidate.approvers : [candidate.owner]);
  }

  latestEvent(candidate) {
    const events = Array.isArray(candidate.events) ? candidate.events : [];
    return events.at(-1) ?? {};
  }

  candidateSummary(candidate) {
    const latest = this.latestEvent(candidate);
    return latest.object_title || candidate.artifact_id || candidate.id;
  }

  candidateLink(candidate) {
    const latest = this.latestEvent(candidate);
    if (latest.object_url) return `<${latest.object_url}|${this.candidateSummary(candidate)}>`;
    return this.candidateSummary(candidate);
  }

  candidateText(candidate) {
    if (candidate.candidate_type === 'content_update') {
      return `변경 검토: ${candidate.artifact_id ?? candidate.id}`;
    }
    if (candidate.candidate_type === 'distill_review') {
      return `요약 초안 검토: ${candidate.suggested_artifact?.title ?? this.candidateSummary(candidate)}`;
    }
    return `매핑 필요: ${this.candidateSummary(candidate)}`;
  }

  buildCandidateBlocks(candidate) {
    const latest = this.latestEvent(candidate);
    const approvers = this.candidateApprovers(candidate).join(', ') || '-';
    const isContentUpdate = candidate.candidate_type === 'content_update';
    const isDistillReview = candidate.candidate_type === 'distill_review';
    const target = candidate.artifact_id ?? 'workspace-log-only';
    const hasUpdateDraft = isContentUpdate && candidate.update_draft?.has_new_info;
    const headline = isContentUpdate
      ? hasUpdateDraft
        ? `*Content update review*\n\`${target}\`의 \`## ${candidate.update_draft.section}\` 섹션에 새 정보를 반영할 준비가 되었습니다.\n> ${candidate.update_draft.summary}`
        : `*Shared content update review*\n\`${target}\` 에 외부 변경을 반영할 준비가 되었습니다.`
      : isDistillReview
        ? `*Auto-distill review*\n${this.candidateLink(candidate)} 에서 canonical 초안을 만들었습니다. 필요하면 Reject 하세요.`
      : `*External mapping required*\n${this.candidateLink(candidate)} 는 아직 정확한 \`x_external_refs\` 연결이 없습니다.`;
    const actionHint = isContentUpdate
      ? '현재 기본 워크플로는 자동 반영 + 사후 거절입니다. 문제가 있으면 Reject 버튼으로 막아주세요.'
      : isDistillReview
        ? '현재 기본 워크플로는 자동 생성 + 사후 거절입니다. 문제가 있으면 Reject 버튼으로 막아주세요.'
      : MANUAL_LINK_REQUIRED_TEXT;
    const actions = [];
    if (isContentUpdate || isDistillReview || candidate.candidate_type === 'unmatched_mapping') {
      actions.push({
        type: 'button',
        action_id: 'fisher_activity_reject_candidate',
        text: { type: 'plain_text', text: 'Reject' },
        style: 'danger',
        value: encodeSlackActionValue({ action: 'reject_candidate', candidate_id: candidate.id }),
        confirm: {
          title: { type: 'plain_text', text: 'Reject candidate?' },
          text: { type: 'mrkdwn', text: 'This will mark the candidate as rejected.' },
          confirm: { type: 'plain_text', text: 'Reject' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      });
    }

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: headline },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `*source:* \`${latest.source ?? '-'}\`` },
          { type: 'mrkdwn', text: `*day:* \`${candidate.reference_day ?? latest.kst_date ?? '-'}\`` },
          { type: 'mrkdwn', text: `*approvers:* \`${approvers}\`` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Target*\n\`${target}\`` },
          { type: 'mrkdwn', text: `*Object*\n${this.candidateLink(candidate)}` },
          { type: 'mrkdwn', text: `*Summary*\n${latest.summary ?? '요약 없음'}` },
          { type: 'mrkdwn', text: `*Policy*\n${candidate.matching_policy ?? candidate.resolution ?? '-'}` },
        ],
      },
      ...(hasUpdateDraft
        ? [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `*추가될 내용 (${candidate.update_draft.section}):*\n\`\`\`\n${(candidate.update_draft.content ?? '').slice(0, 800)}\n\`\`\`` },
          },
          ...(candidate.llm_match ? [{
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `*match confidence:* \`${candidate.llm_match.confidence}\` | *reason:* ${candidate.llm_match.match_reason ?? '-'}` },
            ],
          }] : []),
        ]
        : []),
      ...(isDistillReview
        ? [
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Suggested Type*\n\`${candidate.suggested_artifact?.type ?? '-'}\`` },
              { type: 'mrkdwn', text: `*Signal Score*\n\`${candidate.signal_score ?? '-'}\`` },
              { type: 'mrkdwn', text: `*Draft Title*\n${candidate.suggested_artifact?.title ?? '-'}` },
              { type: 'mrkdwn', text: `*Reason*\n${candidate.selection_reason ?? '-'}` },
            ],
          }
        ]
        : []),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: actionHint },
      },
      ...(actions.length > 0
        ? [{
          type: 'actions',
          elements: actions,
        }]
        : []),
    ];
  }

  candidatesForMember(memberKey) {
    return this.listOpenCandidates().filter((candidate) => this.candidateApprovers(candidate).includes(memberKey));
  }

  async resolveDmChannel(webClient, member) {
    if (member?.slack_user_id) {
      const opened = await webClient.conversations.open({
        users: member.slack_user_id,
      });
      const dmChannel = opened.channel?.id;
      if (dmChannel) return dmChannel;
    }
    if (member?.slack_dm_id) return member.slack_dm_id;
    return null;
  }

  async notifyOpenCandidates(webClient) {
    const state = this.readState();
    const nextState = {};
    const deliveries = [];

    for (const candidate of this.listOpenCandidates()) {
      const candidateState = state[candidate.id] ?? { deliveries: {} };
      candidateState.updated_at = candidate.updated_at;
      const text = this.candidateText(candidate);
      const blocks = this.buildCandidateBlocks(candidate);

      for (const approverKey of this.candidateApprovers(candidate)) {
        const member = this.config.members?.[approverKey];
        if (!member?.slack_user_id && !member?.slack_dm_id) continue;

        const delivery = candidateState.deliveries?.[approverKey];
        if (delivery?.updated_at === candidate.updated_at) continue;

        if (delivery?.channel && delivery?.ts) {
          try {
            await webClient.chat.update({
              channel: delivery.channel,
              ts: delivery.ts,
              text,
              blocks,
            });
            candidateState.deliveries[approverKey] = {
              ...delivery,
              updated_at: candidate.updated_at,
            };
            deliveries.push({ candidate_id: candidate.id, approver: approverKey, mode: 'update' });
            continue;
          } catch {
            // Fall through to a fresh DM if the previous message can no longer be updated.
          }
        }

        try {
          const channel = await this.resolveDmChannel(webClient, member);
          if (!channel) continue;
          const posted = await webClient.chat.postMessage({
            channel,
            text,
            blocks,
          });
          candidateState.deliveries[approverKey] = {
            channel,
            ts: posted.ts,
            updated_at: candidate.updated_at,
          };
          deliveries.push({ candidate_id: candidate.id, approver: approverKey, mode: 'post' });
        } catch {
          // Keep the runtime alive even if one DM delivery fails.
          continue;
        }
      }

      nextState[candidate.id] = candidateState;
    }

    this.writeState(nextState);
    return deliveries;
  }

  parseSlackDmText(text) {
    if (!text || typeof text !== 'string') return null;
    const normalized = text.trim();
    if (!normalized) return null;

    const approveMatch = normalized.match(/^approve\s+(\S+)$/i);
    if (approveMatch && !/^\d+$/.test(approveMatch[1])) {
      return { type: 'approval', action: 'approve', candidateId: approveMatch[1] };
    }

    const rejectMatch = normalized.match(/^reject\s+(\S+)$/i);
    if (rejectMatch && !/^\d+$/.test(rejectMatch[1])) {
      return { type: 'approval', action: 'reject', candidateId: rejectMatch[1] };
    }

    if (/^(approvals|list)$/i.test(normalized)) {
      return { type: 'approval', action: 'list' };
    }

    if (/^help$/i.test(normalized)) {
      return { type: 'help' };
    }

    const inboxCommand = parseInboxCommand(normalized);
    if (inboxCommand) {
      return { type: 'inbox', command: inboxCommand };
    }

    return null;
  }

  async handleCandidateAction(candidateId, slackUserId, decision, webClient = null) {
    const candidate = this.listOpenCandidates().find((entry) => entry.id === candidateId);
    if (!candidate) return '이 요청은 만료되었거나 이미 처리되었습니다.';

    const memberKey = await this.memberKeyForSlackUserId(slackUserId, webClient);
    if (!memberKey || !this.candidateApprovers(candidate).includes(memberKey)) {
      return '이 후보는 지정된 승인자만 처리할 수 있습니다.';
    }

    if (decision === 'approve') {
      if (!['content_update', 'distill_review'].includes(candidate.candidate_type)) return MANUAL_LINK_REQUIRED_TEXT;
      const result = this.client.approveCandidate(candidateId);
      return `반영 완료: \`${result.artifact_id ?? candidate.artifact_id ?? candidateId}\``;
    }

    const result = this.client.rejectCandidate(candidateId);
    return `후보를 기각했습니다: \`${result.id ?? candidateId}\``;
  }
}
