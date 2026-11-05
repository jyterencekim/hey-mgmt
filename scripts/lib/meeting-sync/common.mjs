export function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function uniqueStrings(values) {
  return [...new Set(asArray(values).map((value) => String(value ?? '').trim()).filter(Boolean))];
}

export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeTitle(value) {
  return normalizeWhitespace(value).toLowerCase();
}

export function lower(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function shortId(value, size = 8) {
  return String(value ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, size);
}

export function formatKstDate(value, timeZone = 'Asia/Seoul') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatKstTime(value, timeZone = 'Asia/Seoul') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(':', '');
}

export function lines(text) {
  return String(text ?? '').split(/\r?\n/);
}

export function parseIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseGeminiSubject(subject) {
  const raw = normalizeWhitespace(subject);
  const withoutPrefix = raw.replace(/^Notes:\s*/i, '').trim();
  const quoteMatch = withoutPrefix.match(/[“"](.+?)[”"]/);
  const quotedTitle = quoteMatch?.[1] ?? null;
  const title = quotedTitle
    ? normalizeWhitespace(quotedTitle.replace(/^\((confirmed|tentative)\)\s*/i, ''))
    : normalizeWhitespace(withoutPrefix.replace(/\b[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4}\b.*$/, ''));

  const dateMatch = withoutPrefix.match(/\b([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\b/);
  return {
    raw,
    title: title || raw,
    date_text: dateMatch?.[1] ?? null,
  };
}

export function parseLooseDate(dateText) {
  if (!dateText) return null;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseDateTimeInTimezone(dateText, timeText = null, timeZone = 'Asia/Seoul') {
  if (!dateText) return null;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:\d{2}|KST|UTC)$/i.test(`${dateText} ${timeText ?? ''}`.trim());
  const base = [dateText, timeText].filter(Boolean).join(' ').trim();
  const withZone = hasExplicitZone ? base : `${base} GMT+09:00`;
  const date = new Date(withZone);
  if (Number.isNaN(date.getTime())) {
    return parseLooseDate(base);
  }
  if (timeZone !== 'Asia/Seoul' || hasExplicitZone) {
    return date.toISOString();
  }
  return date.toISOString();
}

export function markdownBulletList(items, emptyLine = '- None recorded.') {
  const normalized = uniqueStrings(items);
  return normalized.length > 0
    ? normalized.map((item) => (item.startsWith('- ') ? item : `- ${item}`)).join('\n')
    : emptyLine;
}

export function sourceUrlList(snapshot) {
  return uniqueStrings([
    snapshot.gmail_message_url,
    snapshot.google_doc_url,
    snapshot.notion_page_url,
    snapshot.source_url,
    ...asArray(snapshot.source_urls),
  ]);
}

export function valueByPath(input, path) {
  if (!input || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), input);
}
