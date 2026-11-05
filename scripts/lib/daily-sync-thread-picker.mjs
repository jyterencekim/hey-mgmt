import { rankFocusTasks } from './task-ranking.mjs';

function normalizeText(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function toRankableTask(artifact) {
  const frontmatter = artifact?.frontmatter ?? {};
  return {
    id: artifact?.id ?? frontmatter.id ?? '',
    type: artifact?.type ?? frontmatter.type ?? 'task',
    title: artifact?.title ?? frontmatter.title ?? artifact?.id ?? frontmatter.id ?? '',
    owner: frontmatter.owner ?? artifact?.owner ?? null,
    status: frontmatter.status ?? artifact?.status ?? null,
    priority: frontmatter.priority ?? artifact?.priority ?? null,
    due_date: frontmatter.due_date ?? artifact?.due_date ?? null,
    created_at: frontmatter.created_at ?? artifact?.created_at ?? null,
  };
}

export function pickDailySyncTaskTitles({
  artifacts,
  member,
  today = null,
  limit = 3,
  includeBlocked = true,
} = {}) {
  const ranked = rankFocusTasks({
    tasks: (artifacts ?? []).map(toRankableTask),
    today,
    member,
    includeBlocked,
  });

  const titles = [];
  const seen = new Set();
  for (const entry of ranked) {
    const title = normalizeText(entry?.task?.title);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
    if (titles.length >= limit) break;
  }
  return titles;
}
