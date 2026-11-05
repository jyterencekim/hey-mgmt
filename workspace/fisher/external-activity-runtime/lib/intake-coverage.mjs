// Connector orchestration helpers. Pure JS so the Codex tool runner can inject
// its own read-only call function; no connector credentials or network client.
export function unpack(result) {
  if (result?.isError) throw new Error(`Connector error: ${JSON.stringify(result.content)}`);
  let data = result?.structuredContent;
  if (!data) {
    const text = (result?.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    try { data = JSON.parse(text); } catch { throw new Error('Connector returned no structured payload'); }
  }
  return data.result ?? data;
}

export function pagination(data) {
  const prose = data.pagination_info ?? '';
  const cursor = data.next_cursor ?? data.next_page_token ?? prose.match(/cursor\s*:?\s*`([^`]+)`/i)?.[1] ?? null;
  const terminal = !cursor && (data.has_more === false || /(?:End of results|no more (?:messages|pages))/i.test(prose) ||
    Object.hasOwn(data, 'next_page_token') && data.next_page_token === null);
  if (!cursor && !terminal) throw new Error('Pagination has no explicit terminal marker or cursor');
  return { cursor, terminal };
}

export function searchRows(data) {
  if (typeof data.results !== 'string') throw new Error('Expected Slack search results text');
  const blocks = data.results.split(/(?=### Result \d+ of \d+)/).filter(x => x.startsWith('### Result '));
  if (!blocks.length && !/No results found|Messages \(0 results\)/.test(data.results)) throw new Error('Unrecognized Slack search body');
  return blocks.map(body => {
    const url = body.match(/Permalink: \[link\]\((https:[^)]+)\)/)?.[1];
    const ts = body.match(/Message_ts: ([\d.]+)/)?.[1];
    const channel = url?.match(/\/archives\/([^/]+)\//)?.[1];
    if (!url || !ts || !channel) throw new Error('Search row lacks source identity');
    return { id: `${channel}:${ts}`, channel, ts, url, threadTs: url.match(/[?&]thread_ts=([\d.]+)/)?.[1] ?? ts, body };
  });
}

export async function collectSearch(call, args) {
  const pages = [], rows = [], cursors = new Set(), identities = new Set();
  let cursor = null;
  do {
    const response = await call({ ...args, ...(cursor ? { cursor } : {}) });
    const data = unpack(response), pageRows = searchRows(data), state = pagination(data);
    const fresh = pageRows.filter(row => !identities.has(row.id));
    if (pageRows.length && !fresh.length) throw new Error('Repeated search page: no new message identities');
    if (rows.length && fresh.length && args.sort === 'timestamp') {
      const previous = Number(rows.at(-1).ts), next = Number(fresh[0].ts);
      if (args.sort_dir === 'asc' ? next < previous : next > previous) throw new Error('Search page moved backwards');
    }
    for (const row of fresh) { identities.add(row.id); rows.push(row); }
    pages.push({ requestCursor: cursor, response, ids: pageRows.map(x => x.id), nextCursor: state.cursor });
    cursor = state.cursor;
    if (cursor && cursors.has(cursor)) throw new Error(`Repeated cursor: ${cursor}`);
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return { pages, rows, terminal: true, nextCursor: null };
}

// Do not repair, decode, or synthesize a provider cursor. On an incomplete
// thread endpoint, read an entire bounded channel search and select the thread.
export async function recoverThreadWindow(call, { channelId, threadTs, after, before, expectedIds }) {
  if (!channelId || !threadTs || !after || !before || !Array.isArray(expectedIds) || !expectedIds.length)
    throw new Error('Recovery needs a fixed window and actual discovery message IDs');
  if (!Number.isFinite(Number(after)) || !Number.isFinite(Number(before)) || Number(after) > Number(before))
    throw new Error('Invalid recovery time window');
  const scan = await collectSearch(call, {
    query: `in:<#${channelId}>`, after, before,
    channel_types: 'public_channel,private_channel,im,mpim',
    sort: 'timestamp', sort_dir: 'asc', limit: 20, include_bots: true,
    include_context: false,
  });
  if (scan.rows.some(x => Number(x.ts) < Number(after) || Number(x.ts) > Number(before)))
    throw new Error('Connector ignored the recovery time window');
  const rows = scan.rows.filter(x => x.threadTs === threadTs);
  const found = new Set(rows.map(x => x.id));
  const missing = expectedIds.filter(id => !found.has(id));
  if (missing.length) throw new Error(`Recovery missed discovery messages: ${missing.join(', ')}`);
  return { ...scan, rows, channelId, threadTs, after, before, expectedIds, scope: 'thread-in-window' };
}

export async function collectThreadWindow(threadCall, searchCall, request) {
  const response = await threadCall({ channel_id: request.channelId, message_ts: request.threadTs, limit: 100 });
  const data = unpack(response);
  if (typeof data.messages !== 'string') throw new Error('Thread body missing');
  const blocks = data.messages.split(/(?=--- Reply \d+ of \d+ ---)/);
  const root = blocks[0].split('=== THREAD REPLIES')[0];
  if (root.match(/Message TS: ([\d.]+)/)?.[1] !== request.threadTs) throw new Error('Thread root identity mismatch');
  const rows = blocks.slice(1).map(body => ({
    id: `${request.channelId}:${body.match(/Message TS: ([\d.]+)/)?.[1]}`,
    ts: body.match(/Message TS: ([\d.]+)/)?.[1], body,
  }));
  if (rows.some(x => !x.ts)) throw new Error('Reply identity missing');
  const inWindow = rows.filter(x => Number(x.ts) >= Number(request.after) && Number(x.ts) <= Number(request.before));
  // Discovery can contain the parent itself. It is real evidence, not a missing reply.
  if (Number(request.threadTs) >= Number(request.after) && Number(request.threadTs) <= Number(request.before))
    inWindow.unshift({ id: `${request.channelId}:${request.threadTs}`, ts: request.threadTs, body: root });
  const found = new Set(inWindow.map(x => x.id));
  const state = pagination(data);
  if (state.terminal && request.expectedIds.every(id => found.has(id)))
    return { root, rows: inWindow, response, terminal: true, nextCursor: null, scope: 'thread-in-window', method: 'thread' };
  // A non-terminal lifetime read is unnecessary for recent coverage. Its
  // cursor is retained as diagnosis while a complete bounded lane replaces it.
  const recovered = await recoverThreadWindow(searchCall, request);
  return { ...recovered, root, response, replacedCursor: state.cursor, method: 'channel-search-recovery' };
}

// Completion is a set of actual content slices, never merely a success/count.
// Retain receipts against the same body string; changed bodies invalidate them.
export function bodyChunks(sourceId, body, maxChars = 7000) {
  if (typeof body !== 'string' || !body.length || !Number.isInteger(maxChars) || maxChars < 1) throw new Error('Invalid body/chunk size');
  const chunks = [];
  for (let start = 0; start < body.length; start += maxChars)
    chunks.push({ sourceId, start, end: Math.min(start + maxChars, body.length), text: body.slice(start, start + maxChars) });
  return chunks;
}

export function assertBodyReviewed(sourceId, body, receipts) {
  const chunks = [...receipts].sort((a, b) => a.start - b.start);
  let offset = 0;
  for (const part of chunks) {
    if (part.sourceId !== sourceId || part.start !== offset || part.end <= part.start || part.text !== body.slice(part.start, part.end))
      throw new Error(`Unread, overlapping, or stale body receipt: ${sourceId}:${offset}`);
    offset = part.end;
  }
  if (!body.length || offset !== body.length) throw new Error(`Unread body tail: ${sourceId}:${offset}/${body.length}`);
  return { sourceId, reviewedCharacters: offset };
}

export function assertThreadCoverage({ expectedIds, recoveredRows, rootRead, reviewedIds, terminal, nextCursor }) {
  const found = new Set(recoveredRows.map(x => x.id));
  const read = new Set(reviewedIds);
  if (!rootRead || !terminal || nextCursor || expectedIds.some(id => !found.has(id)) || recoveredRows.some(x => !read.has(x.id)))
    throw new Error('Incomplete thread coverage: root, discovery hits, pagination, or body review missing');
  return { pass: true, expectedIds, recoveredIds: [...found], reviewedIds: [...read] };
}
