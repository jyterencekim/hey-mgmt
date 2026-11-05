import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadLogState, saveLogState } from './activity-state.mjs';
import { mergeCoalescedItem } from './activity-events.mjs';

const SECTION_START = '<!-- external-activity:start -->';
const SECTION_END = '<!-- external-activity:end -->';

function workspaceLogPath(repoRoot, workspace, date) {
  return resolve(repoRoot, 'workspace', workspace, 'logs', `${date}.md`);
}

function ensureDailyLog(repoRoot, workspace, date) {
  const path = workspaceLogPath(repoRoot, workspace, date);
  if (existsSync(path)) return path;

  mkdirSync(resolve(repoRoot, 'workspace', workspace, 'logs'), { recursive: true });
  const content = `# ${date}

## Plan

## Log
<!-- Time-stamped entries in KST. Format: "- HH:MM — description" -->

## External Signals
${SECTION_START}
${SECTION_END}
`;
  writeFileSync(path, content, 'utf8');
  return path;
}

function renderSection(items) {
  const sorted = [...items].sort((a, b) => String(a.kst_time).localeCompare(String(b.kst_time)));
  const lines = sorted.map((item) => {
    const nativeIds = item.native_change_ids.join(', ');
    return `- ${item.kst_time} — [${item.source}] ${item.title} | URL: ${item.url} | Actor: ${item.actor} | Summary: ${item.summary} | Native IDs: ${nativeIds}`;
  });
  return ['## External Signals', SECTION_START, ...lines, SECTION_END].join('\n');
}

function upsertSection(raw, replacement) {
  const startIdx = raw.indexOf('## External Signals');
  const markerStart = raw.indexOf(SECTION_START);
  const markerEnd = raw.indexOf(SECTION_END);

  if (startIdx === -1 || markerStart === -1 || markerEnd === -1) {
    const trimmed = raw.trimEnd();
    return `${trimmed}\n\n${replacement}\n`;
  }

  const sectionPrefix = raw.slice(0, startIdx);
  const afterSection = raw.slice(markerEnd + SECTION_END.length);
  return `${sectionPrefix}${replacement}${afterSection.startsWith('\n') ? afterSection : `\n${afterSection}`}`;
}

export function ingestWorkspaceLogEvents({ repoRoot, config, events }) {
  const byWorkspaceAndDate = new Map();
  for (const event of events) {
    const key = `${event.workspace_owner}:${event.kst_date}`;
    const bucket = byWorkspaceAndDate.get(key) ?? [];
    bucket.push(event);
    byWorkspaceAndDate.set(key, bucket);
  }

  const results = [];
  for (const [key, bucket] of byWorkspaceAndDate.entries()) {
    const [workspace, date] = key.split(':');
    const state = loadLogState(repoRoot, config, workspace, date);
    const byLogKey = new Map((state.items ?? []).map((item) => [item.key, item]));

    for (const event of bucket) {
      const next = mergeCoalescedItem(byLogKey.get(event.log_key), event);
      byLogKey.set(event.log_key, next);
    }

    const nextState = {
      workspace,
      date,
      items: [...byLogKey.values()],
    };
    saveLogState(repoRoot, config, workspace, date, nextState);

    const logPath = ensureDailyLog(repoRoot, workspace, date);
    const raw = readFileSync(logPath, 'utf8');
    writeFileSync(logPath, upsertSection(raw, renderSection(nextState.items)), 'utf8');
    results.push({ workspace, date, log_path: logPath, item_count: nextState.items.length });
  }

  return results;
}
