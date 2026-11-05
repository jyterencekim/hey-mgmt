import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import matter from 'gray-matter';
import { sendInboxItem } from './inbox.mjs';
import { listMemberEntries } from './members.mjs';

export const MEETING_NOTIFICATION_RECIPIENTS = ['alice', 'bob'];

const NON_HUMAN_OR_EXTERNAL_ROLES = new Set(['shared', 'automation', 'agent-runtime']);
const NON_HUMAN_NAMES = new Set(['team', 'agent', 'fisher']);

export function resolveMeetingNotificationRecipients(repoRoot) {
  const entries = listMemberEntries(repoRoot);
  const internal = entries
    .filter((m) => {
      const role = String(m.role ?? '').toLowerCase();
      if (NON_HUMAN_NAMES.has(m.name)) return false;
      if (NON_HUMAN_OR_EXTERNAL_ROLES.has(role)) return false;
      if (role.startsWith('external')) return false;
      return true;
    })
    .map((m) => m.name);
  return internal.length > 0 ? internal : MEETING_NOTIFICATION_RECIPIENTS;
}

function ledgerPath(repoRoot) {
  return resolve(repoRoot, '.hey', 'sent-meeting-notify.jsonl');
}

function loadLedgerSet(repoRoot) {
  const p = ledgerPath(repoRoot);
  if (!existsSync(p)) return new Set();
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  return new Set(lines.map((l) => {
    const e = JSON.parse(l);
    return `${e.meeting_id}:${e.recipient}`;
  }));
}

function appendLedger(repoRoot, entry) {
  const p = ledgerPath(repoRoot);
  mkdirSync(resolve(repoRoot, '.hey'), { recursive: true });
  appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
}

export async function notifyMeeting({ repoRoot, meetingPath, dryRun = false }) {
  const raw = readFileSync(meetingPath, 'utf8');
  const parsed = matter(raw);
  const fm = parsed.data;

  if (fm.type !== 'meeting') return { skipped: 'not-a-meeting' };

  const owner = fm.owner;
  const recipients = resolveMeetingNotificationRecipients(repoRoot);

  const meetingId = fm.id;
  const relPath = relative(repoRoot, meetingPath);
  const body = `새 미팅록이 등록되었습니다. 읽어주세요.\n\n${relPath}\n\n${parsed.content.trim()}`;
  const title = `[Meeting — 읽어주세요] ${fm.title}`;

  if (dryRun) {
    return { meeting_id: meetingId, dry_run: true, would_send: recipients };
  }

  const sent = [];
  const skippedAlreadySent = [];
  const ledger = loadLedgerSet(repoRoot);

  for (const recipient of recipients) {
    const key = `${meetingId}:${recipient}`;
    if (ledger.has(key)) {
      skippedAlreadySent.push(recipient);
      continue;
    }

    const { item, path } = sendInboxItem({
      repoRoot,
      from: owner,
      to: recipient,
      title,
      body,
      metadata: { x_meeting_id: meetingId, x_meeting_path: relPath, x_kind: 'meeting-notify' },
    });

    appendLedger(repoRoot, { meeting_id: meetingId, recipient, sent_at: new Date().toISOString(), inbox_id: item.id });
    sent.push({ recipient, inbox_id: item.id, path: relative(repoRoot, path) });
  }

  return { meeting_id: meetingId, sent, skipped_already_sent: skippedAlreadySent };
}
