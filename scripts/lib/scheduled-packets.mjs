import { resolve } from 'node:path';
import { loadRepositoryArtifacts } from './repository-artifacts.mjs';

function asArray(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateOnly(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

function packetTrigger(frontmatter) {
  return frontmatter.x_trigger_at
    ?? frontmatter.x_trigger_date
    ?? frontmatter.due_date
    ?? frontmatter.x_due_at
    ?? null;
}

function packetPath(artifact) {
  if (artifact._workspaceMember) {
    return `workspace/${artifact._workspaceMember}/${artifact.relativePath}`;
  }
  return `content/${artifact.relativePath}`;
}

function matchesMember(packet, member) {
  if (!member) return true;

  const audiences = asArray(packet.audience);
  return packet.owner === member
    || packet.workspace === member
    || audiences.includes(member)
    || audiences.includes('team')
    || audiences.includes('@all');
}

export function listScheduledActionPackets(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const dueBefore = dateOnly(options.dueBefore ?? new Date().toISOString().slice(0, 10));
  const includeFuture = Boolean(options.includeFuture);
  const statusFilter = options.status ?? 'active';
  const member = options.member ?? null;

  const { artifacts } = loadRepositoryArtifacts(root);
  const packets = [];

  for (const artifact of artifacts) {
    const fm = artifact.frontmatter ?? {};
    if (artifact.type !== 'note') continue;
    if (String(fm.x_kind ?? '').trim() !== 'scheduled_action') continue;
    if (statusFilter && String(fm.status ?? '') !== statusFilter) continue;

    const triggerRaw = packetTrigger(fm);
    const triggerDate = dateOnly(triggerRaw);
    const packet = {
      id: artifact.id,
      title: artifact.title,
      status: fm.status ?? null,
      owner: fm.owner ?? null,
      workspace: artifact._workspaceMember ?? null,
      audience: asArray(fm.x_audience ?? fm.audience),
      trigger_at: triggerRaw ?? null,
      trigger_date: triggerDate,
      prescribed_action: fm.x_prescribed_action ?? fm.prescribed_action ?? null,
      allowed_actions: asArray(fm.x_allowed_actions ?? fm.allowed_actions),
      expected_output: fm.x_expected_output ?? fm.expected_output ?? null,
      write_back_location: fm.x_write_back_location ?? fm.write_back_location ?? null,
      escalation_rule: fm.x_escalation_rule ?? fm.escalation_rule ?? null,
      expiry: fm.x_expiry ?? fm.expiry ?? null,
      recurrence: fm.x_recurrence ?? fm.recurrence ?? null,
      last_result: fm.x_last_result ?? fm.last_result ?? null,
      surfaced_at: fm.x_surfaced_at ?? null,
      path: packetPath(artifact),
    };

    if (!matchesMember(packet, member)) continue;
    if (!includeFuture && dueBefore && triggerDate && triggerDate > dueBefore) continue;

    packets.push(packet);
  }

  return packets.sort((a, b) => {
    const left = a.trigger_date ?? '9999-99-99';
    const right = b.trigger_date ?? '9999-99-99';
    if (left !== right) return left.localeCompare(right);
    return a.id.localeCompare(b.id);
  });
}

export function formatScheduledActionPackets(packets) {
  if (packets.length === 0) return 'No scheduled action packets found.';

  const lines = [
    '',
    `  ${'ID'.padEnd(38)} ${'Trigger'.padEnd(12)} ${'Owner'.padEnd(12)} Title`,
    `  ${'-'.repeat(38)} ${'-'.repeat(12)} ${'-'.repeat(12)} ${'-'.repeat(32)}`,
  ];

  for (const packet of packets) {
    lines.push(`  ${packet.id.padEnd(38)} ${(packet.trigger_date ?? '-').padEnd(12)} ${(packet.owner ?? '-').padEnd(12)} ${packet.title}`);
  }

  lines.push('', `  ${packets.length} packet(s)`, '');
  return lines.join('\n');
}
