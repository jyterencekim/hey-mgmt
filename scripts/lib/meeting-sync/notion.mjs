import { Client as NotionClient } from '@notionhq/client';
import { mapPeopleValues, resolveOwner } from './people.mjs';
import { normalizeWhitespace, parseIsoOrNull, uniqueStrings } from './common.mjs';
import { splitNotesAndActionItems } from './markdown.mjs';

export function createNotionClient(token = process.env.NOTION_TOKEN) {
  if (!token) {
    throw new Error('Missing NOTION_TOKEN.');
  }
  return new NotionClient({ auth: token });
}

function richTextToString(value = []) {
  return value.map((entry) => entry.plain_text ?? '').join('').trim();
}

function propertyText(property) {
  if (!property) return null;
  switch (property.type) {
    case 'title':
      return richTextToString(property.title);
    case 'rich_text':
      return richTextToString(property.rich_text);
    case 'select':
      return property.select?.name ?? null;
    case 'status':
      return property.status?.name ?? null;
    case 'url':
      return property.url ?? null;
    case 'email':
      return property.email ?? null;
    case 'phone_number':
      return property.phone_number ?? null;
    case 'number':
      return property.number == null ? null : String(property.number);
    case 'formula':
      if (property.formula?.type === 'string') return property.formula.string ?? null;
      if (property.formula?.type === 'number') return property.formula.number == null ? null : String(property.formula.number);
      return null;
    default:
      return null;
  }
}

function propertyDate(property) {
  if (!property) return { start: null, end: null };
  if (property.type === 'date') {
    return {
      start: parseIsoOrNull(property.date?.start),
      end: parseIsoOrNull(property.date?.end),
    };
  }
  return { start: null, end: null };
}

function propertyPeopleValues(property) {
  if (!property) return [];
  if (property.type === 'people') {
    return property.people.map((person) => person.person?.email ?? person.name ?? '').filter(Boolean);
  }
  if (property.type === 'multi_select') {
    return property.multi_select.map((entry) => entry.name).filter(Boolean);
  }
  if (property.type === 'relation') {
    return property.relation.map((entry) => entry.id).filter(Boolean);
  }
  const text = propertyText(property);
  return text ? text.split(/[;,]/).map((value) => value.trim()).filter(Boolean) : [];
}

function blockText(block) {
  const key = block.type;
  const value = block[key];
  return richTextToString(value?.rich_text ?? []);
}

async function listBlockChildren(notion, blockId) {
  const blocks = [];
  let cursor = undefined;
  do {
    const response = await notion.blocks.children.list({ block_id: blockId, start_cursor: cursor, page_size: 100 });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function blocksToMarkdown(notion, blockId, depth = 0) {
  const blocks = await listBlockChildren(notion, blockId);
  const lines = [];
  const todoItems = [];

  for (const block of blocks) {
    const text = normalizeWhitespace(blockText(block));
    switch (block.type) {
      case 'heading_1':
        if (text) lines.push(`# ${text}`);
        break;
      case 'heading_2':
        if (text) lines.push(`## ${text}`);
        break;
      case 'heading_3':
        if (text) lines.push(`### ${text}`);
        break;
      case 'bulleted_list_item':
        if (text) lines.push(`${'  '.repeat(depth)}- ${text}`);
        break;
      case 'numbered_list_item':
        if (text) lines.push(`${'  '.repeat(depth)}1. ${text}`);
        break;
      case 'to_do': {
        const checkbox = block.to_do?.checked ? 'x' : ' ';
        if (text) {
          lines.push(`${'  '.repeat(depth)}- [${checkbox}] ${text}`);
          todoItems.push(text);
        }
        break;
      }
      case 'quote':
        if (text) lines.push(`> ${text}`);
        break;
      case 'callout':
      case 'paragraph':
      default:
        if (text) lines.push(text);
        break;
    }

    if (block.has_children) {
      const nested = await blocksToMarkdown(notion, block.id, depth + 1);
      if (nested.markdown) lines.push(nested.markdown);
      todoItems.push(...nested.todoItems);
    }
  }

  return {
    markdown: lines.filter(Boolean).join('\n\n').trim(),
    todoItems: uniqueStrings(todoItems),
  };
}

function normalizePageProperties(page, config) {
  const props = config.notion?.properties ?? {};
  const titleProperty = page.properties?.[props.title];
  const startProperty = page.properties?.[props.start_at];
  const endProperty = page.properties?.[props.end_at];
  const attendeesProperty = page.properties?.[props.attendees];
  const ownerProperty = page.properties?.[props.owner];
  const eventIdProperty = page.properties?.[props.calendar_event_id];
  const sourceUrlProperty = page.properties?.[props.source_url];

  const startDate = propertyDate(startProperty).start;
  const endDate = propertyDate(endProperty).start ?? propertyDate(startProperty).end ?? propertyDate(endProperty).end;
  const mappedPeople = mapPeopleValues(propertyPeopleValues(attendeesProperty), config);

  return {
    title: propertyText(titleProperty) ?? page.properties?.Name?.title?.[0]?.plain_text ?? 'Imported Meeting',
    start_at: startDate,
    end_at: endDate,
    attendees: mappedPeople.attendees,
    external_attendees: mappedPeople.external_attendees,
    owner: resolveOwner(propertyPeopleValues(ownerProperty)[0] ?? propertyText(ownerProperty), config, config.defaults?.default_owner ?? 'alice'),
    calendar_event_id: propertyText(eventIdProperty),
    source_url: propertyText(sourceUrlProperty) ?? page.url,
  };
}

export async function listNotionMeetingSnapshots({
  notion,
  config,
  since = null,
  limit = 20,
}) {
  const databaseId = config.notion?.database_id;
  if (!databaseId) {
    throw new Error('meeting-ingestion notion.database_id is required for import-notion.');
  }

  const filter = since
    ? {
        timestamp: 'last_edited_time',
        last_edited_time: {
          on_or_after: since,
        },
      }
    : undefined;

  const response = await notion.databases.query({
    database_id: databaseId,
    page_size: limit,
    filter,
    sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
  });

  const snapshots = [];
  for (const page of response.results) {
    const blockResult = await blocksToMarkdown(notion, page.id);
    const split = splitNotesAndActionItems(blockResult.markdown);
    const properties = normalizePageProperties(page, config);
    snapshots.push({
      source: 'notion',
      external_id: `notion:${page.id}`,
      notion_page_id: page.id,
      notion_page_url: page.url,
      source_url: properties.source_url,
      source_urls: uniqueStrings([page.url, properties.source_url]),
      title: properties.title,
      start_at: properties.start_at,
      end_at: properties.end_at,
      owner: properties.owner,
      attendees: properties.attendees,
      external_attendees: properties.external_attendees,
      calendar_event_id: properties.calendar_event_id,
      notes_md: split.notes || blockResult.markdown,
      action_items: uniqueStrings([...split.action_items, ...blockResult.todoItems]),
      updated_at: page.last_edited_time,
      parse_status: properties.start_at && properties.end_at && properties.attendees.length > 0 ? 'ready' : 'missing_required_fields',
    });
  }

  return snapshots;
}

export const __testables__ = {
  normalizePageProperties,
};
