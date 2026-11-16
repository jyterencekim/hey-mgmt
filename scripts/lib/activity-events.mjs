import { createHash } from 'node:crypto';

function asString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`activity event requires non-empty string field '${field}'`);
  }
  return value.trim();
}

function formatInTimeZone(date, options) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    ...options,
  }).format(date);
}

export function toKstDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid changed_at: ${value}`);
  return formatInTimeZone(date, { year: 'numeric', month: '2-digit', day: '2-digit' }).replaceAll('-', '-');
}

export function toKstTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid changed_at: ${value}`);
  return formatInTimeZone(date, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function signatureFor(values) {
  return createHash('sha256').update(values.join('|')).digest('hex').slice(0, 16);
}

export function normalizeActivityEvent(event) {
  const changedAt = asString(event.changed_at, 'changed_at');
  const normalized = {
    source: asString(event.source, 'source').toLowerCase(),
    object_type: asString(event.object_type, 'object_type'),
    object_id: asString(event.object_id, 'object_id'),
    object_title: asString(event.object_title, 'object_title'),
    object_url: asString(event.object_url, 'object_url'),
    actor: asString(event.actor, 'actor'),
    workspace_owner: asString(event.workspace_owner, 'workspace_owner').toLowerCase(),
    changed_at: changedAt,
    native_change_id: asString(event.native_change_id, 'native_change_id'),
    summary: asString(event.summary, 'summary'),
    raw_ref: typeof event.raw_ref === 'string' && event.raw_ref.trim() ? event.raw_ref.trim() : null,
    content_hint: event.content_hint && typeof event.content_hint === 'object' ? event.content_hint : null,
  };

  normalized.kst_date = toKstDate(changedAt);
  normalized.kst_time = toKstTime(changedAt);
  normalized.log_key = `${normalized.source}:${normalized.object_id}:${normalized.kst_date}`;
  normalized.signature = signatureFor([
    normalized.source,
    normalized.object_id,
    normalized.kst_date,
    normalized.native_change_id,
  ]);
  return normalized;
}

export function loadActivityEventsFromFile(raw) {
  const parsed = JSON.parse(raw);
  const events = Array.isArray(parsed) ? parsed : parsed?.events;
  if (!Array.isArray(events)) {
    throw new Error('activity ingest file must be a JSON array or an object with an events array');
  }
  return events.map(normalizeActivityEvent);
}

export function mergeCoalescedItem(existing, event) {
  if (!existing) {
    return {
      key: event.log_key,
      source: event.source,
      object_id: event.object_id,
      object_type: event.object_type,
      title: event.object_title,
      url: event.object_url,
      actor: event.actor,
      workspace_owner: event.workspace_owner,
      changed_at: event.changed_at,
      kst_date: event.kst_date,
      kst_time: event.kst_time,
      summary: event.summary,
      native_change_ids: [event.native_change_id],
      event_signatures: [event.signature],
      content_hints: event.content_hint ? [event.content_hint] : [],
    };
  }

  const mergedSummary = existing.summary.includes(event.summary)
    ? existing.summary
    : `${existing.summary}; ${event.summary}`;

  const latest = new Date(existing.changed_at) >= new Date(event.changed_at) ? existing : event;

  return {
    ...existing,
    title: latest.object_title ?? existing.title,
    url: latest.object_url ?? existing.url,
    actor: latest.actor ?? existing.actor,
    changed_at: latest.changed_at ?? existing.changed_at,
    kst_time: latest.kst_time ?? existing.kst_time,
    summary: mergedSummary,
    native_change_ids: [...new Set([...existing.native_change_ids, event.native_change_id])],
    event_signatures: [...new Set([...existing.event_signatures, event.signature])],
    content_hints: event.content_hint ? [...existing.content_hints, event.content_hint] : existing.content_hints,
  };
}

/**
 * Normalize a lightweight event pushed by a host-agent MCP/plugin bridge
 * (slack/drive/notion/gmail/confluence/github) into a canonical activity event.
 */
export function normalizeAgentPushedEvent(raw = {}, { defaultWorkspaceOwner = 'alice' } = {}) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('pushed event must be a JSON object');
  }

  const source = String(raw.source ?? '').trim().toLowerCase();
  if (!source) {
    throw new Error("pushed event requires non-empty string field 'source'");
  }

  const objectId = String(raw.object_id ?? raw.id ?? '').trim();
  if (!objectId) {
    throw new Error("pushed event requires non-empty string field 'object_id'");
  }

  const changedAt = String(raw.changed_at ?? raw.updated_at ?? raw.timestamp ?? '').trim() || new Date().toISOString();
  const objectTitle = String(raw.object_title ?? raw.title ?? raw.name ?? objectId).trim();
  const objectUrl = String(raw.object_url ?? raw.url ?? raw.permalink ?? `${source}://${objectId}`).trim();
  const workspaceOwner = String(raw.workspace_owner ?? defaultWorkspaceOwner ?? 'alice').trim().toLowerCase();
  const actor = String(raw.actor ?? raw.author ?? workspaceOwner).trim();
  const objectType = String(raw.object_type ?? raw.type ?? `${source}-item`).trim();
  const nativeChangeId = String(raw.native_change_id ?? raw.change_id ?? `${objectId}:${changedAt}`).trim();
  const summary = String(raw.summary ?? raw.text ?? raw.snippet ?? objectTitle).trim();

  return normalizeActivityEvent({
    ...raw,
    source,
    object_type: objectType,
    object_id: objectId,
    object_title: objectTitle,
    object_url: objectUrl,
    actor,
    workspace_owner: workspaceOwner,
    changed_at: changedAt,
    native_change_id: nativeChangeId,
    summary,
  });
}
