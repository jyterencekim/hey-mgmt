import { unpack, pagination, searchRows, assertBodyReviewed } from './intake-coverage.mjs';

// Own connector invocation and pagination evidence; callers cannot certify a lane
// with pages:1/results:0/terminal:true. This is an in-process gate, not an app hook.
export class IntakeRun {
  #lanes = new Map();
  #bodies = new Map();
  #receipts = new Map();
  #dispositions = new Map();
  #discovered = new Set();
  #sourceKeys = new Map();
  #priorDispositions;
  constructor({ after, before, required, priorDispositions = {} }) {
    if (!Number.isFinite(Date.parse(after)) || !Number.isFinite(Date.parse(before)) || Date.parse(after) >= Date.parse(before)) throw new Error('Invalid fixed window');
    if (!Array.isArray(required) || !required.length || new Set(required).size !== required.length) throw new Error('Required lanes must be nonempty and unique');
    this.window = Object.freeze({ after, before });
    this.required = [...required];
    this.#priorDispositions = new Map(Object.entries(priorDispositions));
  }
  async collect(name, call, args, { kind = 'slack', cursorKey = 'cursor' } = {}) {
    if (this.#lanes.has(name)) throw new Error(`Already collected: ${name}`);
    const lane = { pages: [], rows: [], complete: false, error: null };
    this.#lanes.set(name, lane);
    let cursor = null;
    const seen = new Set(), identities = new Set();
    try {
      do {
        const raw = await call({ ...args, ...(cursor ? { [cursorKey]: cursor } : {}) });
        const data = unpack(raw);
        if (data.error) throw new Error(String(data.error));
        const rows = kind === 'slack' ? searchRows(data) : data.emails ?? data.results;
        if (!Array.isArray(rows)) throw new Error('Missing actual rows');
        if (rows.length && rows.every(row => identities.has(row.id ?? row.url))) throw new Error('Repeated discovery page');
        const state = kind === 'slack' ? pagination(data) : {
          cursor: data.next_page_token ?? data.next_cursor ?? null,
          terminal: data.has_more !== true && !data.next_page_token && !data.next_cursor,
        };
        lane.pages.push({ requestCursor: cursor, raw, nextCursor: state.cursor });
        lane.rows.push(...rows);
        for (const row of rows) {
          const id = row.id ?? row.url;
          if (!id) throw new Error('Discovery row lacks identity');
          identities.add(id);
          this.#discovered.add(id);
          const modified = row.modifiedTime ?? row.modified_time ?? null;
          const sourceKey = row.intakeKey ?? (name === 'drive' && modified ? `${name}:${id}:${modified}` : `${name}:${id}`);
          this.#sourceKeys.set(id, sourceKey);
          const prior = this.#priorDispositions.get(sourceKey) ?? this.#priorDispositions.get(id);
          if (prior && !this.#bodies.has(id)) this.#dispositions.set(id, prior);
        }
        if (!state.cursor && !state.terminal) throw new Error('Non-terminal lane');
        cursor = state.cursor;
        if (cursor && seen.has(cursor)) throw new Error('Repeated cursor');
        if (cursor) seen.add(cursor);
      } while (cursor);
      lane.complete = true;
      return lane.rows;
    } catch (e) { lane.error = String(e); throw e; }
  }
  select(id, body) {
    if (!id || typeof body !== 'string' || !body) throw new Error('Missing selected body');
    this.#bodies.set(id, body);
    this.#receipts.set(id, []);
    this.#dispositions.delete(id);
  }
  dismiss(id, evidence) {
    if (!this.#discovered.has(id) || !evidence) throw new Error('Dismissal needs discovery and reason');
    if (this.#bodies.has(id)) throw new Error('Selected bodies require full review');
    this.#dispositions.set(id, { status: 'irrelevant', evidence });
  }
  next(id) {
    const body = this.#bodies.get(id);
    if (!body) throw new Error('Unknown body');
    const start = this.#receipts.get(id).at(-1)?.end ?? 0;
    return start === body.length ? null : { sourceId: id, start, end: Math.min(start + 7000, body.length), text: body.slice(start, start + 7000) };
  }
  acknowledge(chunk) {
    const expected = this.next(chunk.sourceId);
    if (!expected || JSON.stringify(expected) !== JSON.stringify(chunk)) throw new Error('Out-of-order or stale receipt');
    this.#receipts.get(chunk.sourceId).push(chunk);
  }
  classify(id, disposition) {
    assertBodyReviewed(id, this.#bodies.get(id), this.#receipts.get(id));
    if (!['pending', 'applied', 'excluded', 'irrelevant'].includes(disposition.status) || !disposition.evidence) throw new Error('Disposition needs evidence');
    this.#dispositions.set(id, disposition);
  }
  checkpoint() {
    const priorDispositions = {};
    for (const [id, disposition] of this.#dispositions) {
      const key = this.#sourceKeys.get(id);
      if (key) priorDispositions[key] = disposition;
    }
    return { priorDispositions };
  }
  finish() {
    const errors = this.required.filter(n => !this.#lanes.get(n)?.complete).map(n => `Incomplete lane: ${n}`);
    for (const id of this.#discovered) if (!this.#dispositions.has(id)) errors.push(`Untriaged discovery: ${id}`);
    for (const id of this.#bodies.keys()) if (!this.#dispositions.has(id)) errors.push(`Unreviewed/unclassified: ${id}`);
    return { window: this.window, complete: errors.length === 0, errors,
      lanes: Object.fromEntries([...this.#lanes].map(([k,v]) => [k, { pages: v.pages.length, rows: v.rows.length, complete: v.complete, error: v.error }])),
      pending: [...this.#dispositions].filter(([,d]) => d.status === 'pending').map(([id,d]) => ({ id, ...d })),
    };
  }
}
