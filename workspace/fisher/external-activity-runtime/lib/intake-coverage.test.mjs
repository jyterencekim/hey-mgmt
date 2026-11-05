import test from 'node:test';
import assert from 'node:assert/strict';
import { unpack, pagination, collectSearch, recoverThreadWindow, collectThreadWindow, bodyChunks, assertBodyReviewed, assertThreadCoverage } from './intake-coverage.mjs';
const row = (ts, thread = '1.0') => `### Result 1 of 1\nMessage_ts: ${ts}\nPermalink: [link](https://kaiafoundation.slack.com/archives/C1/p123?thread_ts=${thread}&cid=C1)\nText: original ${ts}\n`;
const page = (ts, cursor = null) => ({ content: [{ type: 'text', text: JSON.stringify({ results: ts ? row(ts) : 'No results found.', pagination_info: cursor ? `For next page use cursor \`${cursor}\`` : 'End of results - No more pages available.' }) }] });
test('unwraps real top-level structured rows without reducing to counts', () => assert.deepEqual(unpack({ structuredContent: { results: [{ url: 'x' }] } }).results, [{ url: 'x' }]));
test('requires explicit terminal evidence and preserves opaque cursor', () => {
  assert.deepEqual(pagination({ pagination_info: 'use cursor: `bmV4dF90czoxNzgwNDc0NzEwNjE2ODI5`' }), { cursor: 'bmV4dF90czoxNzgwNDc0NzEwNjE2ODI5', terminal: false });
  assert.throws(() => pagination({}));
});
test('rejects a repeated page even when the provider claims terminal', async () => {
  let n = 0;
  await assert.rejects(collectSearch(async () => page('2.0', n++ === 0 ? 'opaque' : null), {}), /Repeated search page/);
});
test('rejects cursor regression and temporal backtracking', async () => {
  let n = 0;
  await assert.rejects(collectSearch(async () => n++ ? page('1.0') : page('2.0', 'opaque'), { sort: 'timestamp', sort_dir: 'asc' }), /backwards/);
});
test('recovers discovered replies with unchanged fixed window and cursors', async () => {
  const calls = [];
  const result = await recoverThreadWindow(async args => { calls.push(args); return calls.length === 1 ? page('2.0', 'provider-opaque') : page('3.0'); }, { channelId: 'C1', threadTs: '1.0', after: '2', before: '4', expectedIds: ['C1:2.0', 'C1:3.0'] });
  assert.equal(calls[1].cursor, 'provider-opaque');
  assert.equal(calls[1].after, '2'); assert.equal(calls[1].before, '4');
  assert.equal(result.rows.length, 2);
});
test('terminal reply result still fails if a search-discovered message is absent', async () => {
  await assert.rejects(recoverThreadWindow(async () => page('2.0'), { channelId: 'C1', threadTs: '1.0', after: '2', before: '4', expectedIds: ['C1:3.0'] }), /missed discovery/);
});
test('ignoring a requested time filter is not successful recovery', async () => {
  await assert.rejects(recoverThreadWindow(async () => page('1.0'), { channelId: 'C1', threadTs: '1.0', after: '2', before: '4', expectedIds: ['C1:1.0'] }), /ignored/);
});
test('thread terminal lie automatically switches to the bounded search', async () => {
  const result = await collectThreadWindow(async () => ({ structuredContent: { messages: '=== THREAD PARENT MESSAGE ===\nMessage TS: 1.0\nroot\nNo thread messsages', pagination_info: 'There are no more messages in this thread.' } }), async () => page('2.0'), { channelId: 'C1', threadTs: '1.0', after: '2', before: '4', expectedIds: ['C1:2.0'] });
  assert.equal(result.method, 'channel-search-recovery');
  assert.equal(result.rows[0].id, 'C1:2.0');
});
test('long-body tail and edited body cannot be acknowledged by count or stale receipts', () => {
  const body = 'a'.repeat(15001), chunks = bodyChunks('doc', body);
  assert.throws(() => assertBodyReviewed('doc', body, chunks.slice(0, 2)), /tail/);
  assert.throws(() => assertBodyReviewed('doc', 'b' + body.slice(1), chunks), /stale/);
  assert.equal(assertBodyReviewed('doc', body, chunks).reviewedCharacters, 15001);
});
test('thread success requires both root and every actual recovered body', () => {
  const input = { expectedIds: ['C1:2'], recoveredRows: [{ id: 'C1:2' }], rootRead: true, reviewedIds: [], terminal: true, nextCursor: null };
  assert.throws(() => assertThreadCoverage(input));
  assert.equal(assertThreadCoverage({ ...input, reviewedIds: ['C1:2'] }).pass, true);
});
