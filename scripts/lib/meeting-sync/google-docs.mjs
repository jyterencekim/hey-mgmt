import { google } from 'googleapis';
import { mapPeopleValues, resolveOwner } from './people.mjs';
import { parseDateTimeInTimezone, uniqueStrings, normalizeWhitespace } from './common.mjs';
import { splitNotesAndActionItems } from './markdown.mjs';

function textFromElements(elements = []) {
  return elements
    .map((element) => element.textRun?.content ?? element.autoText?.content ?? '')
    .join('')
    .replace(/\n/g, '')
    .trim();
}

function collectParagraphs(content = [], out = []) {
  for (const block of content) {
    if (block.paragraph) {
      const text = textFromElements(block.paragraph.elements);
      if (!text) continue;
      out.push({
        text,
        style: block.paragraph.paragraphStyle?.namedStyleType ?? 'NORMAL_TEXT',
        bullet: Boolean(block.paragraph.bullet),
      });
      continue;
    }

    if (block.table) {
      for (const row of block.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) {
          collectParagraphs(cell.content ?? [], out);
        }
      }
      continue;
    }

    if (block.tableOfContents) {
      collectParagraphs(block.tableOfContents.content ?? [], out);
    }
  }
  return out;
}

function googleDocToMarkdown(document) {
  const paragraphs = collectParagraphs(document.body?.content ?? []);
  const lines = [];
  for (const paragraph of paragraphs) {
    const text = normalizeWhitespace(paragraph.text);
    if (!text) continue;

    if (paragraph.bullet) {
      lines.push(`- ${text}`);
      continue;
    }

    if (paragraph.style === 'HEADING_1') {
      lines.push(`# ${text}`);
      continue;
    }
    if (paragraph.style === 'HEADING_2') {
      lines.push(`## ${text}`);
      continue;
    }
    if (paragraph.style === 'HEADING_3') {
      lines.push(`### ${text}`);
      continue;
    }

    lines.push(text);
  }
  return lines.join('\n\n').trim();
}

function findField(lines, patterns) {
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function parseRangeFromText(value, fallbackDateText, timeZone) {
  if (!value && !fallbackDateText) return { start_at: null, end_at: null };
  const raw = String(value ?? '').trim();
  const timeOnlyMatch = raw.match(/^(\d{1,2}(?::\d{2})?\s*[AP]M)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*[AP]M)$/i);
  if (timeOnlyMatch && fallbackDateText) {
    return {
      start_at: parseDateTimeInTimezone(fallbackDateText, timeOnlyMatch[1], timeZone),
      end_at: parseDateTimeInTimezone(fallbackDateText, timeOnlyMatch[2], timeZone),
    };
  }

  const fullMatch = raw.match(/^(.+?)\s+(\d{1,2}(?::\d{2})?\s*[AP]M)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*[AP]M)$/i);
  if (fullMatch) {
    const dateText = normalizeWhitespace(fullMatch[1].replace(/[,\s]+$/, '')) || fallbackDateText;
    return {
      start_at: parseDateTimeInTimezone(dateText, fullMatch[2], timeZone),
      end_at: parseDateTimeInTimezone(dateText, fullMatch[3], timeZone),
    };
  }

  return { start_at: null, end_at: null };
}

function extractMetadata({ document, markdown, fallbackTitle, fallbackDateText, config }) {
  const textLines = markdown.split(/\r?\n/).map((line) => normalizeWhitespace(line)).filter(Boolean);
  const dateText = findField(textLines, [/^date:\s*(.+)$/i]) ?? fallbackDateText;
  const whenText = findField(textLines, [/^when:\s*(.+)$/i]);
  const timeText = findField(textLines, [/^time:\s*(.+)$/i]);
  const attendeesText = findField(textLines, [/^attendees?:\s*(.+)$/i, /^participants?:\s*(.+)$/i]);
  const ownerText = findField(textLines, [/^owner:\s*(.+)$/i, /^organizer:\s*(.+)$/i]);
  const calendarEventId = findField(textLines, [/^calendar event id:\s*(.+)$/i, /^event id:\s*(.+)$/i]);

  const whenRange = parseRangeFromText(whenText, dateText, config.defaults?.timezone);
  const timeRange = whenRange.start_at || whenRange.end_at
    ? whenRange
    : parseRangeFromText(timeText, dateText, config.defaults?.timezone);

  const people = attendeesText
    ? attendeesText.split(/[;,]/).map((value) => value.trim()).filter(Boolean)
    : [];
  const mappedPeople = mapPeopleValues(people, config);

  return {
    title: document.title || fallbackTitle || 'Imported Meeting',
    start_at: timeRange.start_at,
    end_at: timeRange.end_at,
    attendees: mappedPeople.attendees,
    external_attendees: mappedPeople.external_attendees,
    owner: resolveOwner(ownerText, config, config.defaults?.default_owner ?? 'jared'),
    calendar_event_id: calendarEventId ?? null,
  };
}

export async function fetchGoogleDocSnapshot({
  auth,
  config,
  googleDocId = null,
  googleFileId = null,
  fallbackTitle = null,
  fallbackDateText = null,
  gmailMessage = null,
  docsService = null,
  driveService = null,
}) {
  const drive = driveService ?? google.drive({ version: 'v3', auth });
  let docId = googleDocId;
  let fileId = googleFileId ?? googleDocId;
  let webViewLink = null;
  let driveMetadata = null;

  if (fileId && !docId) {
    driveMetadata = (await drive.files.get({
      fileId,
      fields: 'id,name,mimeType,webViewLink',
      supportsAllDrives: true,
    })).data;
    webViewLink = driveMetadata.webViewLink ?? null;
    if (driveMetadata.mimeType === 'application/vnd.google-apps.document') {
      docId = driveMetadata.id;
    }
  }

  if (!docId) {
    return {
      source: 'gmail',
      external_id: `gmail:${gmailMessage?.gmail_message_id ?? googleFileId ?? 'unknown'}`,
      gmail_message_id: gmailMessage?.gmail_message_id ?? null,
      google_file_id: fileId ?? null,
      google_doc_id: null,
      google_doc_url: webViewLink ?? gmailMessage?.google_doc_url ?? null,
      title: fallbackTitle ?? gmailMessage?.title ?? 'Imported Meeting',
      owner: config.defaults?.default_owner ?? 'jared',
      attendees: [],
      external_attendees: [],
      notes_md: '',
      action_items: [],
      source_url: gmailMessage?.source_url ?? webViewLink ?? null,
      updated_at: gmailMessage?.updated_at ?? new Date().toISOString(),
      parse_status: 'pending_fetch',
    };
  }

  const docs = docsService ?? google.docs({ version: 'v1', auth });
  const document = (await docs.documents.get({ documentId: docId })).data;
  const markdown = googleDocToMarkdown(document);
  const split = splitNotesAndActionItems(markdown);
  const metadata = extractMetadata({
    document,
    markdown,
    fallbackTitle,
    fallbackDateText,
    config,
  });
  const noteUrls = uniqueStrings([
    gmailMessage?.gmail_message_url,
    gmailMessage?.google_doc_url,
    webViewLink,
    `https://docs.google.com/document/d/${docId}/edit`,
  ]);

  return {
    source: 'gmail',
    external_id: `gmail:${gmailMessage?.gmail_message_id ?? docId}`,
    gmail_message_id: gmailMessage?.gmail_message_id ?? null,
    gmail_thread_id: gmailMessage?.gmail_thread_id ?? null,
    google_doc_id: docId,
    google_file_id: fileId ?? docId,
    gmail_message_url: gmailMessage?.gmail_message_url ?? null,
    google_doc_url: webViewLink ?? `https://docs.google.com/document/d/${docId}/edit`,
    source_url: webViewLink ?? gmailMessage?.source_url ?? `https://docs.google.com/document/d/${docId}/edit`,
    source_urls: noteUrls,
    title: metadata.title,
    start_at: metadata.start_at,
    end_at: metadata.end_at,
    owner: metadata.owner,
    attendees: metadata.attendees,
    external_attendees: metadata.external_attendees,
    calendar_event_id: metadata.calendar_event_id,
    notes_md: split.notes || markdown,
    action_items: split.action_items,
    updated_at: gmailMessage?.updated_at ?? new Date().toISOString(),
    parse_status: metadata.start_at && metadata.end_at && metadata.attendees.length > 0 ? 'ready' : 'missing_required_fields',
  };
}

export const __testables__ = {
  googleDocToMarkdown,
  extractMetadata,
  parseRangeFromText,
};
