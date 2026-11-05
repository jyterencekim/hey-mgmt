const LIST_PATTERNS = [
  /^inbox$/i,
  /^📬$/,
  /^받은함$/i,
  /^my inbox$/i,
];

const ACTION_PATTERNS = [
  { intent: 'ack', pattern: /^(ack|✅|확인|ok|read|got it)\s+(.+)$/i },
  { intent: 'discard', pattern: /^(discard|❌|삭제|skip|nope|버려)\s+(.+)$/i },
  { intent: 'show', pattern: /^(show|👀|보기|detail|open)\s+(.+)$/i },
];

const BARE_NUMBER = /^\d+$/;
const INBOX_ID = /^inbox_[a-z0-9]+$/i;

function normalize(text) {
  return text.trim().replace(/\s+/g, ' ');
}

function parseTarget(rawTarget) {
  const trimmed = rawTarget.trim();
  if (BARE_NUMBER.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  if (INBOX_ID.test(trimmed)) return trimmed;
  return null;
}

export function parseInboxCommand(text) {
  if (typeof text !== 'string') return null;

  const normalized = normalize(text);
  if (!normalized) return null;

  if (LIST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { intent: 'list', target: null };
  }

  for (const { intent, pattern } of ACTION_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const target = parseTarget(match[2]);
    if (target !== null) return { intent, target };
  }

  if (BARE_NUMBER.test(normalized)) {
    return { intent: 'show', target: Number.parseInt(normalized, 10) };
  }

  return null;
}
