import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDigestBlocks,
  buildPromotedThreadBlocks,
  buildObservedThreadBlocks,
} from '../activity-digest.mjs';

const makePromoted = (overrides = {}) => ({
  signature: 'sig-p0',
  date: '2026-04-08',
  source: 'github',
  title: 'Promoted Item',
  actor: 'terence.kim (KR)',
  time: '2026-04-08T04:12:00.000Z',
  url: 'https://github.com/superearn/x/pull/1',
  relevance: 'high',
  promoted_to: 'task_example',
  reason: 'Thread reports implementation progress',
  summary: 'Added the thing',
  ...overrides,
});

const makeObserved = (overrides = {}) => ({
  signature: 'sig-o0',
  date: '2026-04-08',
  source: 'slack',
  title: 'Observed Item',
  actor: 'oliver.kim (KR)',
  time: '2026-04-08T06:00:00.000Z',
  url: 'https://kaiafoundation.slack.com/archives/C1/p1',
  relevance: 'moderate',
  reason: 'Discussion worth watching',
  ...overrides,
});

describe('buildDigestBlocks (summary header)', () => {
  it('empty digest returns a summary title header + Korean empty message', () => {
    const blocks = buildDigestBlocks({ promoted: [], observed: [], schedule: '12:00' });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].type, 'header');
    assert.equal(blocks[0].text.text, '오늘 새로 정리할 변화는 없습니다.');
    assert.ok(blocks[1].text.text.includes('새로 올라온 내용이 없습니다'));
  });

  it('renders importance-sorted summary bullets and open questions without predefined domains', () => {
    const promoted = [
      makePromoted({ signature: 'a1', promoted_to: 'note_hf', summary: 'HF deposit lag fixed with immediate refresh path (commit 41a0f4a)' }),
      makePromoted({ signature: 'a2', promoted_to: 'note_rwa', summary: 'RWA vault lockup direction aligned for next week' }),
      makePromoted({ signature: 'a3', promoted_to: 'note_portfolio', summary: 'Morpho and APYX allocation narrowed for short-term rebalance' }),
    ];
    const observed = [
      makeObserved({ summary: 'Yield8 NAV sync risk still needs review' }),
    ];
    const blocks = buildDigestBlocks({ promoted, observed, schedule: '12:00', maxHeadlineBullets: 10 });
    const summary = blocks[1].text.text;
    assert.ok(summary.includes('HF deposit lag fixed'));
    assert.ok(summary.includes('RWA vault lockup direction aligned'));
    assert.ok(summary.includes('Morpho and APYX allocation narrowed'));
    assert.ok(summary.includes('commit 41a0f4a'));
    assert.equal(blocks[2].type, 'divider');
    assert.ok(blocks[3].text.text.includes('*열린 질문*'));
  });

  it('reports no new observations when empty', () => {
    const blocks = buildDigestBlocks({ promoted: [], observed: [], schedule: '12:00' });
    assert.ok(blocks[1].text.text.includes('새로 올라온 내용이 없습니다'));
  });

  it('uses a meaningful one-line Korean summary title instead of a fixed digest label', () => {
    const promoted = [
      makePromoted({ summary: 'HF deposit lag fixed with immediate refresh path' }),
    ];
    const blocks = buildDigestBlocks({ promoted, observed: [], schedule: '12:00' });
    assert.ok(blocks[0].text.text.includes('HF deposit lag fixed'));
    assert.ok(!blocks[0].text.text.includes('Fisher Digest'));
  });
});

describe('buildPromotedThreadBlocks (grouped detail)', () => {
  it('collapses multiple events for the same artifact into one block', () => {
    const items = [
      makePromoted({ signature: 'a1', promoted_to: 'task_drive', title: 'Drive collector: My Drive fix', reason: 'Fix works' }),
      makePromoted({ signature: 'a2', promoted_to: 'task_drive', title: 'Drive collector: tests passing' }),
      makePromoted({ signature: 'a3', promoted_to: 'task_drive', title: 'Drive collector: policy doc' }),
    ];
    const blocks = buildPromotedThreadBlocks({ items });
    // Header + divider + 1 group block (no trailing divider)
    const sectionBlocks = blocks.filter((b) => b.type === 'section');
    const headerText = sectionBlocks[0].text.text;
    assert.ok(headerText.includes('3 events'));
    assert.ok(headerText.includes('1 artifact'));

    const groupBlocks = sectionBlocks.filter((b) => b.accessory?.action_id === 'fisher_activity_revoke');
    assert.equal(groupBlocks.length, 1);
    const groupText = groupBlocks[0].text.text;
    assert.ok(groupText.includes('`task_drive`'));
    assert.ok(groupText.includes('3 events'));
    assert.equal(groupBlocks[0].accessory.text.text, 'Revoke (3)');

    const value = JSON.parse(groupBlocks[0].accessory.value);
    assert.equal(value.action, 'revoke');
    assert.deepEqual(value.related_signatures, ['a1', 'a2', 'a3']);
  });

  it('single-item group uses plain Revoke button without related_signatures', () => {
    const items = [makePromoted({ signature: 'only', promoted_to: 'note_x' })];
    const blocks = buildPromotedThreadBlocks({ items });
    const groupBlock = blocks.find((b) => b.accessory?.action_id === 'fisher_activity_revoke');
    assert.equal(groupBlock.accessory.text.text, 'Revoke');
    const value = JSON.parse(groupBlock.accessory.value);
    assert.equal(value.signature, 'only');
    assert.equal(value.related_signatures, undefined);
  });

  it('renders actor, time window, source icon, and substance', () => {
    const items = [
      makePromoted({
        signature: 'a1',
        source: 'slack',
        promoted_to: 'task_x',
        actor: 'terence.kim (KR)',
        time: '2026-04-08T04:00:00.000Z',
        summary: 'Budget $5000 finalized',
        url: 'https://example.com/a',
      }),
      makePromoted({
        signature: 'a2',
        source: 'slack',
        promoted_to: 'task_x',
        actor: 'oliver.kim (KR)',
        time: '2026-04-08T09:30:00.000Z',
        summary: 'Owner approved allocation',
        url: 'https://example.com/b',
      }),
    ];
    const blocks = buildPromotedThreadBlocks({ items });
    const group = blocks.find((b) => b.accessory?.action_id === 'fisher_activity_revoke');
    const text = group.text.text;
    assert.ok(text.includes('terence.kim'));
    assert.ok(text.includes('oliver.kim'));
    assert.ok(text.includes('speech_balloon'));
    assert.ok(text.includes('Budget $5000 finalized'));
    assert.ok(text.includes('Owner approved allocation'));
    assert.ok(text.includes('https://example.com/a'));
    assert.ok(text.match(/→/), 'time range with arrow');
  });

  it('cleans the #channel prefix from slack titles', () => {
    const items = [
      makePromoted({
        signature: 'a1',
        source: 'slack',
        title: '#superearn_dev Let us inspect docs repo and investigate drift',
        promoted_to: null,
      }),
    ];
    const blocks = buildPromotedThreadBlocks({ items });
    const group = blocks.find((b) => b.accessory?.action_id === 'fisher_activity_revoke');
    // The group header should show the cleaned title, not the "#superearn_dev" prefix
    assert.ok(group.text.text.includes('Let us inspect docs repo'));
  });

  it('maxItems caps the number of groups displayed', () => {
    const items = Array.from({ length: 20 }, (_, i) => makePromoted({
      signature: `g${i}`,
      promoted_to: `task_${i}`,
    }));
    const blocks = buildPromotedThreadBlocks({ items, maxItems: 5 });
    const groupBlocks = blocks.filter((b) => b.accessory?.action_id === 'fisher_activity_revoke');
    assert.equal(groupBlocks.length, 5);
    const contextBlock = blocks.find((b) => b.type === 'context');
    assert.ok(contextBlock);
    assert.ok(contextBlock.elements[0].text.includes('+15 more'));
  });
});

describe('buildObservedThreadBlocks', () => {
  it('observation blocks include actor, time, and a delete button', () => {
    const items = [
      makeObserved({ signature: 'o1' }),
      makeObserved({ signature: 'o2' }),
    ];
    const blocks = buildObservedThreadBlocks({ items });
    const sectionBlocks = blocks.filter(
      (b) => b.type === 'section' && b.accessory?.action_id === 'fisher_activity_delete_observation'
    );
    assert.equal(sectionBlocks.length, 2);
    const first = sectionBlocks[0];
    assert.ok(first.text.text.includes('Observed Item'));
    assert.ok(first.text.text.includes('oliver.kim'));
    assert.equal(first.accessory.text.text, 'Delete');
    assert.ok(first.accessory.value.includes('"signature":"o1"'));
  });

  it('cleans #channel prefixes and renders the source icon', () => {
    const items = [
      makeObserved({ title: '#general hey there team', source: 'slack' }),
    ];
    const blocks = buildObservedThreadBlocks({ items });
    const section = blocks.find((b) => b.accessory?.action_id === 'fisher_activity_delete_observation');
    assert.ok(section.text.text.includes('hey there team'));
    assert.ok(!section.text.text.match(/\*#general hey/));
  });
});
