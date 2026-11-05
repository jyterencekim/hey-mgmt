const USER_AGENT = 'Mozilla/5.0 (compatible; hey-distill/1.0)';
const MAX_CONTENT_LENGTH = 50000;

function stripHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|h[1-6]|div|section|article|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
}

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function collapseWhitespace(text) {
  return String(text ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function htmlToPlainText(html) {
  return collapseWhitespace(decodeEntities(stripHtml(html)));
}

function collectJsonStrings(value, bucket = [], depth = 0) {
  if (depth > 4 || bucket.length >= 30) return bucket;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) bucket.push(trimmed);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJsonStrings(entry, bucket, depth + 1);
      if (bucket.length >= 30) break;
    }
    return bucket;
  }
  if (!value || typeof value !== 'object') return bucket;

  const preferredKeys = ['text', 'title', 'name', 'summary', 'description', 'content'];
  for (const key of preferredKeys) {
    if (key in value) collectJsonStrings(value[key], bucket, depth + 1);
    if (bucket.length >= 30) return bucket;
  }

  if (value.message?.text) collectJsonStrings(value.message.text, bucket, depth + 1);
  if (Array.isArray(value.messages)) {
    for (const message of value.messages) {
      if (message?.text) collectJsonStrings(message.text, bucket, depth + 1);
    }
  }

  return bucket;
}

export function extractUrls(text) {
  const found = new Set();

  for (const match of String(text ?? '').matchAll(/<(https?:\/\/[^|>]+)(?:\|[^>]*)?>/g)) {
    found.add(match[1]);
  }

  const mdPattern = /\[(?:[^\]]*)\]\((https?:\/\/[^)]+)\)/g;
  for (const match of String(text ?? '').matchAll(mdPattern)) {
    found.add(match[1]);
  }

  const plainPattern = /(?<![<(])https?:\/\/[^\s<>"')]+/g;
  for (const match of String(text ?? '').matchAll(plainPattern)) {
    found.add(match[0]);
  }

  return [...found];
}

export async function fetchUrlContent(url, { timeoutMs = 10000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    const raw = await response.text();

    let text;
    if (contentType.includes('application/json')) {
      try {
        const parsed = JSON.parse(raw);
        text = collectJsonStrings(parsed).join('\n\n');
      } catch {
        text = raw;
      }
    } else if (contentType.includes('text/html')) {
      text = htmlToPlainText(raw);
    } else {
      text = collapseWhitespace(raw);
    }

    return text.slice(0, MAX_CONTENT_LENGTH) || null;
  } catch {
    return null;
  }
}

export async function followLinks(sourceText, { maxLinks = 5, timeoutMs = 10000 } = {}) {
  const urls = extractUrls(sourceText).slice(0, maxLinks);
  const parts = [];

  for (const url of urls) {
    const content = await fetchUrlContent(url, { timeoutMs });
    if (content) {
      parts.push(`[${url}]\n${content}`);
    }
  }

  return {
    linkedContent: parts.join('\n\n---\n\n'),
    urls,
    fetchedCount: parts.length,
  };
}
