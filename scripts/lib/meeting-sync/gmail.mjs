import { Buffer } from 'node:buffer';
import { google } from 'googleapis';
import { load as loadHtml } from 'cheerio';
import { gmailUser } from './google-auth.mjs';
import { lower, normalizeWhitespace, parseGeminiSubject } from './common.mjs';

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function extractHeader(headers, name) {
  return headers?.find((header) => lower(header.name) === lower(name))?.value ?? '';
}

function collectBodies(part, acc = { html: [], text: [] }) {
  if (!part) return acc;
  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === 'text/html') acc.html.push(decoded);
    if (part.mimeType === 'text/plain') acc.text.push(decoded);
  }
  for (const child of part.parts ?? []) {
    collectBodies(child, acc);
  }
  return acc;
}

function linkKind(text, href) {
  const joined = `${text} ${href}`.toLowerCase();
  if (/open meeting notes/.test(joined)) return 'open_meeting_notes';
  if (/attachment/.test(joined)) return 'attachment';
  if (href.includes('docs.google.com/document')) return 'open_meeting_notes';
  if (href.includes('drive.google.com')) return 'attachment';
  return 'other';
}

function extractGoogleIds(href) {
  const docMatch = String(href).match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docMatch) {
    return { google_doc_id: docMatch[1], google_file_id: docMatch[1] };
  }

  const fileMatch = String(href).match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) {
    return { google_doc_id: null, google_file_id: fileMatch[1] };
  }

  const openMatch = String(href).match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) {
    return { google_doc_id: null, google_file_id: openMatch[1] };
  }

  return { google_doc_id: null, google_file_id: null };
}

function collectLinks({ html, text }) {
  const links = [];
  if (html) {
    const $ = loadHtml(html);
    $('a[href]').each((_, node) => {
      const href = normalizeWhitespace($(node).attr('href'));
      if (!href) return;
      const textContent = normalizeWhitespace($(node).text());
      links.push({ href, text: textContent, kind: linkKind(textContent, href), ...extractGoogleIds(href) });
    });
  }

  const urlMatches = String(text ?? '').match(/https?:\/\/[^\s)>]+/g) ?? [];
  for (const href of urlMatches) {
    links.push({ href, text: '', kind: linkKind('', href), ...extractGoogleIds(href) });
  }

  const deduped = new Map();
  for (const link of links) {
    if (!link.href) continue;
    deduped.set(link.href, link);
  }
  return [...deduped.values()];
}

function pickBestLink(links, priorities = []) {
  const order = new Map(priorities.map((kind, index) => [kind, index]));
  const ranked = [...links].sort((left, right) => {
    const leftRank = order.has(left.kind) ? order.get(left.kind) : Number.MAX_SAFE_INTEGER;
    const rightRank = order.has(right.kind) ? order.get(right.kind) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.href.localeCompare(right.href);
  });
  return ranked[0] ?? null;
}

function messageBodies(message) {
  const collected = collectBodies(message.payload);
  return {
    html: collected.html.join('\n'),
    text: collected.text.join('\n'),
  };
}

function isEligibleMessage({ from, subject, config }) {
  const allowedSender = lower(config.gmail?.allowed_sender);
  const senderOk = !allowedSender || lower(from).includes(allowedSender);
  const subjectPrefix = String(config.gmail?.subject_prefix ?? '').trim();
  const subjectOk = !subjectPrefix || subject.startsWith(subjectPrefix);
  return senderOk && subjectOk;
}

function normalizeNotificationMessage({ message, config }) {
  const headers = message.payload?.headers ?? [];
  const from = extractHeader(headers, 'From');
  const to = extractHeader(headers, 'To');
  const subject = extractHeader(headers, 'Subject');
  if (!isEligibleMessage({ from, subject, config })) return null;

  const bodies = messageBodies(message);
  const links = collectLinks(bodies);
  const preferredLink = pickBestLink(links, config.gmail?.link_priority ?? []);
  const subjectMeta = parseGeminiSubject(subject);
  const internalDate = Number(message.internalDate ?? 0);

  return {
    source: 'gmail',
    external_id: `gmail:${message.id}`,
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId ?? null,
    gmail_message_url: `https://mail.google.com/mail/u/0/#all/${message.id}`,
    google_doc_id: preferredLink?.google_doc_id ?? null,
    google_file_id: preferredLink?.google_file_id ?? null,
    google_doc_url: preferredLink?.href ?? null,
    source_url: preferredLink?.href ?? `https://mail.google.com/mail/u/0/#all/${message.id}`,
    title: subjectMeta.title || subject,
    subject,
    fallback_date_text: subjectMeta.date_text,
    updated_at: internalDate > 0 ? new Date(internalDate).toISOString() : new Date().toISOString(),
    parse_status: preferredLink ? 'linked' : 'pending_fetch',
    raw_html: bodies.html,
    raw_text: bodies.text,
    sender: from,
    recipient: to,
  };
}

export async function listGeminiNotificationMessages({
  auth,
  config,
  since = null,
  limit = 20,
  gmailService = null,
}) {
  const gmail = gmailService ?? google.gmail({ version: 'v1', auth });
  const userId = gmailUser(config);
  const listResult = await gmail.users.messages.list({
    userId,
    q: config.gmail?.query || undefined,
    labelIds: (config.gmail?.label_ids ?? []).length > 0 ? config.gmail.label_ids : undefined,
    maxResults: Math.max(limit * 4, limit),
  });

  const threshold = since ? Date.parse(since) : null;
  const items = [];
  for (const item of listResult.data.messages ?? []) {
    const response = await gmail.users.messages.get({
      userId,
      id: item.id,
      format: 'full',
    });
    const normalized = normalizeNotificationMessage({ message: response.data, config });
    if (!normalized) continue;
    if (threshold && Date.parse(normalized.updated_at) < threshold) continue;
    items.push(normalized);
    if (items.length >= limit) break;
  }

  return items.sort((left, right) => Date.parse(left.updated_at) - Date.parse(right.updated_at));
}

export const __testables__ = {
  collectLinks,
  extractGoogleIds,
  normalizeNotificationMessage,
  pickBestLink,
};
