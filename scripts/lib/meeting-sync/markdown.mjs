import { lines, markdownBulletList, normalizeWhitespace, uniqueStrings } from './common.mjs';

export function parseH2Sections(body) {
  const sections = new Map();
  const order = [];
  let current = null;
  let buffer = [];
  let preamble = [];

  const flush = () => {
    if (!current) return;
    sections.set(current, buffer.join('\n').trim());
    order.push(current);
  };

  for (const line of lines(body)) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      flush();
      current = match[1].trim();
      buffer = [];
      continue;
    }

    if (!current) {
      preamble.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();

  return {
    preamble: preamble.join('\n').trim(),
    sections,
    order,
  };
}

function normalizeSectionName(name) {
  return normalizeWhitespace(name).toLowerCase();
}

export function splitNotesAndActionItems(markdown) {
  const parsed = parseH2Sections(markdown);
  if (parsed.order.length === 0) {
    return {
      notes: String(markdown ?? '').trim(),
      action_items: extractTaskLines(markdown),
    };
  }

  const notes = [];
  const actions = [];
  for (const name of parsed.order) {
    const content = parsed.sections.get(name) ?? '';
    if (/^action items?$|^next steps?$/.test(normalizeSectionName(name))) {
      actions.push(...extractTaskLines(content));
      continue;
    }
    notes.push(`## ${name}\n${content}`.trim());
  }

  return {
    notes: notes.join('\n\n').trim(),
    action_items: uniqueStrings(actions),
  };
}

export function extractTaskLines(markdown) {
  const tasks = [];
  for (const line of lines(markdown)) {
    const trimmed = line.trim();
    const taskMatch = trimmed.match(/^[-*]\s+\[(?: |x)\]\s+(.+)$/i);
    if (taskMatch) {
      tasks.push(taskMatch[1].trim());
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) && /(?:action|todo|follow[- ]?up)/i.test(trimmed)) {
      tasks.push(trimmed.replace(/^[-*]\s+/, '').trim());
    }
  }
  return uniqueStrings(tasks);
}

export function serializeMeetingBody({
  context = '',
  notes = '',
  actionItems = [],
  sources = [],
  preservedSections = [],
}) {
  const sections = [
    ['Context', context.trim() || '<!-- Imported meeting context -->'],
    ['Notes', notes.trim() || '<!-- Imported meeting notes -->'],
    ['Action Items', markdownBulletList(actionItems)],
    ['Sources', markdownBulletList(sources, '- No source URLs captured.')],
  ];

  const preserved = preservedSections
    .filter(([name]) => !['context', 'notes', 'action items', 'sources'].includes(normalizeSectionName(name)))
    .map(([name, content]) => [`${name}`, String(content ?? '').trim()]);

  return [...sections, ...preserved]
    .map(([name, content]) => `## ${name}\n${content}`.trim())
    .join('\n\n')
    .trim() + '\n';
}
