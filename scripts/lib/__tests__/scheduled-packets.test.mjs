import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listScheduledActionPackets } from '../scheduled-packets.mjs';

let tmpRoot;

function writeMarkdown(path, frontmatter, body = 'Body') {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---', '', body, '');
  writeFileSync(path, lines.join('\n'), 'utf8');
}

describe('listScheduledActionPackets()', () => {
  beforeEach(() => {
    tmpRoot = resolve(tmpdir(), `test-packets-${Date.now()}`);
    mkdirSync(resolve(tmpRoot, 'content/vocab'), { recursive: true });
    mkdirSync(resolve(tmpRoot, 'workspace/charlie'), { recursive: true });
    writeFileSync(resolve(tmpRoot, 'content/vocab/members.yml'), 'members:\n  - name: charlie\n  - name: fisher\n', 'utf8');
    writeMarkdown(resolve(tmpRoot, 'workspace/charlie/due.md'), {
      id: 'note_due-packet',
      type: 'note',
      title: 'Due packet',
      status: 'active',
      owner: 'charlie',
      x_kind: 'scheduled_action',
      x_trigger_at: '2026-05-07',
      x_audience: ['charlie', 'fisher'],
      x_prescribed_action: 'Check the loop board',
    });
    writeMarkdown(resolve(tmpRoot, 'workspace/charlie/future.md'), {
      id: 'note_future-packet',
      type: 'note',
      title: 'Future packet',
      status: 'active',
      owner: 'charlie',
      x_kind: 'scheduled_action',
      x_trigger_at: '2026-05-08',
      x_audience: ['charlie'],
      x_prescribed_action: 'Later',
    });
  });

  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('returns due packets for a member', () => {
    const packets = listScheduledActionPackets(tmpRoot, {
      member: 'charlie',
      dueBefore: '2026-05-07',
    });
    assert.deepEqual(packets.map((packet) => packet.id), ['note_due-packet']);
  });
});
