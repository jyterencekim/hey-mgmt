/**
 * Builds Slack Block Kit blocks for the Fisher twice-daily digest.
 *
 * Strategy:
 *   - Lead with a short, human-readable bulletin: the most important iteration
 *     movement, hidden risks, reminders, and encouragement, capped at 10 bullets.
 *   - Group promoted items by `promoted_to` artifact so multiple events that
 *     updated the same artifact collapse into ONE rich group entry.
 *   - Observations stay available in-thread for moderation, but the top digest
 *     should answer “what matters now?” instead of dumping raw updates.
 */

const SOURCE_ICON = {
  slack: ':speech_balloon:',
  confluence: ':page_facing_up:',
  drive: ':file_folder:',
  github: ':octocat:',
  meeting: ':studio_microphone:',
  notion: ':memo:',
};

function cleanString(value) {
  const s = String(value ?? '').trim();
  if (!s || s === 'null' || s === 'undefined') return '';
  return s;
}

function cleanTitle(source, rawTitle) {
  const title = cleanString(rawTitle);
  if (!title) return '';
  if (source === 'slack') {
    const m = title.match(/^#\S+\s+(.*)$/);
    if (m) return m[1].trim() || title;
  }
  return title;
}

function shortTitle(title, max = 140) {
  if (!title) return '';
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function formatKst(iso) {
  const value = cleanString(iso);
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed) + ' KST';
}

function formatSource(source) {
  const label = cleanString(source).toLowerCase() || 'unknown';
  const icon = SOURCE_ICON[label] ?? ':small_orange_diamond:';
  return `${icon} ${label}`;
}

function uniq(values) {
  return [...new Set(values.map(cleanString).filter(Boolean))];
}

function artifactKind(artifactId) {
  const m = cleanString(artifactId).match(/^(task|note|decision|playbook|initiative)_/);
  return m ? m[1] : 'artifact';
}

function groupItems(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || `orphan:${item.signature}`;
    if (!map.has(key)) map.set(key, { key, items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}

function encodeActionValue(payload) {
  return JSON.stringify(payload);
}

function bulletScore(item) {
  let score = 0;
  const kind = artifactKind(item.promoted_to);
  if (kind === 'decision') score += 10;
  if (kind === 'task') score += 8;
  if (kind === 'initiative') score += 7;
  if (kind === 'playbook') score += 6;
  if (item.source === 'meeting') score += 4;
  if (item.source === 'confluence' || item.source === 'drive') score += 3;
  if (cleanString(item.summary)) score += 3;
  if (cleanString(item.reason)) score += 2;
  if (/block|risk|issue|delay|stuck|urgent|due|deadline|reminder|qa|launch|audit|deploy/i.test(`${item.summary ?? ''} ${item.reason ?? ''} ${item.title ?? ''}`)) {
    score += 5;
  }
  return score;
}


function extractCommitHashes(item) {
  const hay = `${cleanString(item.summary)} ${cleanString(item.reason)} ${cleanTitle(item.source, item.title)}`;
  const matches = [...hay.matchAll(/(?:commit\s+|`)([0-9a-f]{7,12})(?:`)?\b/gi)].map((m) => m[1]);
  return uniq(matches).slice(0, 3);
}

function localizeText(text) {
  const s = cleanString(text);
  if (!s) return '';

  const replacements = [
    [/HF QA execution report now includes the full test matrix and consolidated issue baseline/gi, 'HF QA 실행 보고서에 전체 테스트 매트릭스와 통합 이슈 기준선이 반영됨'],
    [/Immediate-refresh workaround opened for HF deposit status lag, and frontend PR #298 was merged/gi, 'HF 입금 반영 지연 대응용 즉시 새로고침 우회안 적용, 프론트 PR #298 머지 완료'],
    [/HF freshness workaround confirmed, PR #298 merged to trigger immediate post-action refresh/gi, 'HF 최신화 우회안 확정, PR #298 머지로 작업 직후 즉시 새로고침 가능해짐'],
    [/RWA vault discussion centered on an 8% yield product with a 6-month lockup as a separate vault\./gi, 'RWA 볼트는 연 8% 수익률, 6개월 락업의 별도 볼트로 논의가 모아짐.'],
    [/If confirmed around next week midweek, the team needs vault deployment and frontend updates\./gi, '다음 주 중 확정되면 볼트 배포와 프론트 수정이 필요함.'],
    [/Shared roadmap shows the USDT deposit campaign reached 1,889 wallets and \$44\.2M AUM by 2026-04-15\./gi, '공유 로드맵 기준 USDT 예치 캠페인은 2026-04-15 시점 1,889개 지갑, AUM 4,420만 달러에 도달함.'],
    [/Daily sync notes indicate the discussed project\/service was considered eligible\./gi, '데일리 싱크 노트상 해당 프로젝트/서비스는 진행 가능 대상으로 정리됨.'],
    [/The only concrete next requirement captured is that an API key is needed before development can proceed\./gi, '다만 개발 착수 전 API 키 확보가 선행 조건으로 남아 있음.'],
    [/The auto-generated transcript is low fidelity, so this should be recorded as an observation rather than auto-promoted knowledge\./gi, '자동 생성 기록의 정확도가 낮아 지식 승격보다 관찰 항목으로 두는 편이 적절함.'],
    [/Yield8 브릿지 토큰의 NAV 동기화 리스크 검토 필요/gi, 'Yield8 브릿지 토큰의 NAV 동기화 리스크 검토 필요'],
    [/APYX는 당분간 Morpho 경유 보수 편입, APYX·wsrUSD·reUSD 조합으로 5~6% 수익률 유지 방향 정리/gi, 'APYX는 당분간 Morpho 경유로 보수 편입하고, APYX·wsrUSD·reUSD 조합으로 5~6% 수익률 유지 방향이 정리됨'],
  ];

  let out = s;
  for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
  return out;
}


function summarizeForHeadline(item) {
  const summary = localizeText(cleanString(item.summary) || cleanString(item.reason) || cleanTitle(item.source, item.title));
  return shortTitle(summary, 70);
}

function buildDigestTitle({ promoted, observed }) {
  const all = [...promoted, ...observed].sort((a, b) => bulletScore(b) - bulletScore(a));
  const lead = all[0];
  if (!lead) return '오늘 새로 정리할 변화는 없습니다.';

  return summarizeForHeadline(lead) || '오늘 핵심 변화 요약';
}

function buildSummaryBullets({ promoted, maxItems }) {
  const lines = [];
  const items = [...promoted].sort((a, b) => bulletScore(b) - bulletScore(a));

  for (const item of items) {
    const summary = summarizeForHeadline(item);
    const commits = extractCommitHashes(item);
    const hasCommitText = /commit\s+[0-9a-f]{7,12}/i.test(summary);
    const commitSuffix = commits.length > 0 && !hasCommitText ? ` (commit ${commits.join(', ')})` : '';
    const bullet = `• ${summary}${commitSuffix}`;
    if (!lines.includes(bullet)) lines.push(bullet);
    if (lines.length >= maxItems) break;
  }

  return lines;
}

function buildOpenQuestionBullets({ observed, maxItems = 3 }) {
  const questions = [];
  const candidates = observed.filter((item) => /risk|issue|delay|blocked|null|missing|stale|reminder|deadline|qa|need|open|검토|확인|리스크|이슈|지연|누락|필요/.test(`${item.reason ?? ''} ${item.summary ?? ''} ${item.title ?? ''}`));

  for (const item of candidates) {
    const signal = shortTitle(localizeText(cleanString(item.summary) || cleanString(item.reason) || cleanTitle(item.source, item.title)), 90);
    const bullet = `• ${signal}`;
    if (!questions.includes(bullet)) questions.push(bullet);
    if (questions.length >= maxItems) break;
  }

  return questions;
}

export function buildDigestBlocks({ promoted, observed, schedule, maxHeadlineBullets = 10 }) {
  const title = buildDigestTitle({ promoted, observed });
  const header = {
    type: 'header',
    text: { type: 'plain_text', text: title },
  };

  const promotedCount = promoted.length;
  const observedCount = observed.length;

  if (promotedCount + observedCount === 0) {
    return [
      header,
      {
        type: 'section',
        text: { type: 'mrkdwn', text: ':sleeping: 새로 올라온 내용이 없습니다.' },
      },
    ];
  }

  const summaryBullets = buildSummaryBullets({ promoted, maxItems: maxHeadlineBullets });
  const openQuestions = buildOpenQuestionBullets({ observed, maxItems: 3 });
  const bodyBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text: summaryBullets.join('\n') } },
  ];

  if (openQuestions.length > 0) {
    bodyBlocks.push({ type: 'divider' });
    bodyBlocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ['*열린 질문*', ...openQuestions].join('\n'),
      },
    });
  }

  return [header, ...bodyBlocks];
}

function buildPromotedGroupBlock({ key, items }) {
  const first = items[0];
  const isGroup = !key.startsWith('orphan:') && items.length > 1;
  const count = items.length;

  const sources = uniq(items.map((i) => i.source));
  const actors = uniq(items.map((i) => i.actor)).slice(0, 5);
  const times = items.map((i) => cleanString(i.time)).filter(Boolean).sort();
  const promotedTo = cleanString(first.promoted_to);

  const headerText = promotedTo
    ? `*:sparkles: ${artifactKind(promotedTo).toUpperCase()} updated* — \`${promotedTo}\``
    : `*:sparkles: ${shortTitle(cleanTitle(first.source, first.title), 140) || '(unlinked promotion)'}*`;

  const metaParts = [];
  if (sources.length > 0) metaParts.push(sources.map(formatSource).join(' '));
  if (actors.length > 0) metaParts.push(`by ${actors.join(', ')}`);
  if (times.length > 0) {
    const firstTs = formatKst(times[0]);
    const lastTs = formatKst(times[times.length - 1]);
    metaParts.push(firstTs && lastTs && firstTs !== lastTs ? `${firstTs} → ${lastTs}` : (firstTs || lastTs));
  }
  metaParts.push(`${count} event${count === 1 ? '' : 's'}`);

  const summaries = uniq(items.map((i) => i.summary).filter(Boolean));
  const reasons = uniq(items.map((i) => i.reason).filter(Boolean));
  const substance = summaries.length > 0 ? summaries : reasons;

  const lines = [
    headerText,
    metaParts.filter(Boolean).join(' · '),
  ];

  if (substance.length > 0) {
    lines.push('');
    const bullets = substance.slice(0, 3).map((s) => `• ${shortTitle(s, 240)}`);
    lines.push(...bullets);
    if (substance.length > 3) lines.push(`_…+${substance.length - 3} more_`);
  }

  const withUrls = items.filter((i) => cleanString(i.url));
  if (withUrls.length > 0) {
    lines.push('');
    const samples = withUrls.slice(0, 3).map((ev) => {
      const t = shortTitle(cleanTitle(ev.source, ev.title), 100) || cleanString(ev.source) || 'source';
      return `:link: <${ev.url}|${t}>`;
    });
    lines.push(samples.join('  '));
  }

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
    accessory: {
      type: 'button',
      action_id: 'fisher_activity_revoke',
      text: { type: 'plain_text', text: isGroup ? `Revoke (${count})` : 'Revoke' },
      style: 'danger',
      value: encodeActionValue({
        action: 'revoke',
        signature: first.signature,
        date: first.date,
        ...(isGroup ? { related_signatures: items.map((i) => i.signature) } : {}),
      }),
      confirm: {
        title: { type: 'plain_text', text: isGroup ? 'Revoke group promotion?' : 'Revoke promotion?' },
        text: {
          type: 'mrkdwn',
          text: isGroup
            ? `This will demote all ${count} events promoted to this artifact back to observation status.`
            : 'This will demote the promoted item back to observation status.',
        },
        confirm: { type: 'plain_text', text: 'Revoke' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    },
  };
}

export function buildPromotedThreadBlocks({ items, maxItems = 10 }) {
  if (!items.length) return [];

  const groups = groupItems(items, (o) => cleanString(o.promoted_to))
    .sort((a, b) => b.items.length - a.items.length);
  const displayGroups = groups.slice(0, maxItems);

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Promoted to team knowledge* — ${items.length} event${items.length === 1 ? '' : 's'} across ${groups.length} artifact${groups.length === 1 ? '' : 's'}`,
      },
    },
    { type: 'divider' },
  ];

  for (const group of displayGroups) {
    blocks.push(buildPromotedGroupBlock(group));
    blocks.push({ type: 'divider' });
  }

  if (groups.length > displayGroups.length) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_+${groups.length - displayGroups.length} more artifact group${groups.length - displayGroups.length === 1 ? '' : 's'} — raise \`digest.max_items_per_section\` in config to show more._`,
        },
      ],
    });
  } else if (blocks.at(-1)?.type === 'divider') {
    blocks.pop();
  }

  return blocks;
}

function buildObservedBlock(item) {
  const title = shortTitle(cleanTitle(item.source, item.title), 140) || '(untitled)';
  const metaParts = [];
  if (cleanString(item.source)) metaParts.push(formatSource(item.source));
  if (cleanString(item.actor)) metaParts.push(`by ${cleanString(item.actor)}`);
  const timeStr = formatKst(item.time);
  if (timeStr) metaParts.push(timeStr);
  if (cleanString(item.relevance)) metaParts.push(`relevance: ${cleanString(item.relevance)}`);

  const lines = [
    `*${title}*`,
    metaParts.join(' · '),
  ];
  const substance = cleanString(item.summary) || cleanString(item.reason);
  if (substance) lines.push('', `_${shortTitle(substance, 260)}_`);
  if (cleanString(item.url)) lines.push('', `:link: <${item.url}|Open source>`);

  return {
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
    accessory: {
      type: 'button',
      action_id: 'fisher_activity_delete_observation',
      text: { type: 'plain_text', text: 'Delete' },
      style: 'danger',
      value: encodeActionValue({
        action: 'delete_observation',
        signature: item.signature,
        date: item.date,
      }),
      confirm: {
        title: { type: 'plain_text', text: 'Delete observation?' },
        text: { type: 'mrkdwn', text: 'This will remove the observation from the digest staging area.' },
        confirm: { type: 'plain_text', text: 'Delete' },
        deny: { type: 'plain_text', text: 'Cancel' },
      },
    },
  };
}

export function buildObservedThreadBlocks({ items, maxItems = 10 }) {
  if (!items.length) return [];
  const slice = items.slice(0, maxItems);
  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Observations (${items.length})*` },
    },
    { type: 'divider' },
  ];
  for (const item of slice) {
    blocks.push(buildObservedBlock(item));
  }
  if (items.length > slice.length) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_+${items.length - slice.length} more observation${items.length - slice.length === 1 ? '' : 's'} not shown._`,
        },
      ],
    });
  }
  return blocks;
}
