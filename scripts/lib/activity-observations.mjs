import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function observationFilePath(repoRoot, date) {
  return resolve(repoRoot, 'workspace/fisher/observations', `${date}.md`);
}

function s(value) {
  return (value == null || value === 'null') ? '' : String(value).replace(/\r?\n+/g, ' ').trim();
}

function normalizeDedupeText(value) {
  return s(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<!--[^>]+-->/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function observationDedupeKey(obs) {
  const source = s(obs.source).toLowerCase();
  const url = s(obs.url);
  if (source && url) return [source, url].join('|');

  return [
    source,
    normalizeDedupeText(obs.title),
    normalizeDedupeText(obs.summary || obs.reason),
  ].join('|');
}

function hasDuplicateObservation(existing, obs) {
  const nextKey = observationDedupeKey(obs);
  if (!nextKey.replaceAll('|', '')) return false;
  return readObservationsFromRaw(existing)
    .some((entry) => observationDedupeKey(entry) === nextKey);
}

export function writeObservation(repoRoot, obs) {
  if (!obs.signature || !obs.date) return;

  const filePath = observationFilePath(repoRoot, obs.date);

  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `# Fisher Observations — ${obs.date}\n`, 'utf8');
  }

  // Dedup: skip if this signature or materially identical source item exists.
  const existing = readFileSync(filePath, 'utf8');
  if (existing.includes(`<!-- obs:${obs.signature} `)) return;
  if (hasDuplicateObservation(existing, obs)) return;

  const display = (v) => s(v) || '-';
  const lines = [
    `\n<!-- obs:${obs.signature} tier:${obs.tier} -->`,
    `### [${display(obs.source)}] ${display(obs.title)}`,
    `- **Actor**: ${display(obs.actor)}`,
    `- **Time**: ${display(obs.time)}`,
    `- **URL**: ${display(obs.url)}`,
    `- **Relevance**: ${display(obs.relevance)}`,
    `- **Reason**: ${display(obs.reason)}`,
  ];

  if (obs.summary != null && obs.summary !== 'null' && String(obs.summary).trim() !== '') {
    lines.push(`- **Summary**: ${s(obs.summary)}`);
  }

  if (obs.promoted_to != null && obs.promoted_to !== 'null') {
    lines.push(`- **Promoted_to**: ${obs.promoted_to}`);
  }

  appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function collectMarkers(raw) {
  const markerRe = /<!-- obs:(\S+) tier:(\S+) -->/g;
  const markers = [];
  let m;
  while ((m = markerRe.exec(raw)) !== null) {
    markers.push({ index: m.index, end: m.index + m[0].length, signature: m[1], tier: m[2] });
  }
  return markers;
}

function getField(block, field) {
  const re = new RegExp(`\\*\\*${field}\\*\\*: (.+)`);
  const m = block.match(re);
  return m ? m[1].trim() : '';
}

function readObservationsFromRaw(raw) {
  const markers = collectMarkers(raw);

  return markers.map(({ end, signature, tier }, i) => {
    const blockEnd = i + 1 < markers.length ? markers[i + 1].index : raw.length;
    const block = raw.slice(end, blockEnd);

    const titleMatch = block.match(/### \[([^\]]+)\] (.+)/);
    const source = titleMatch ? titleMatch[1] : '';
    const title = titleMatch ? titleMatch[2].trim() : '';
    const promoted_to = getField(block, 'Promoted_to') || undefined;
    const summary = getField(block, 'Summary');

    return {
      signature,
      tier,
      source,
      title,
      actor: getField(block, 'Actor'),
      time: getField(block, 'Time'),
      url: getField(block, 'URL'),
      relevance: getField(block, 'Relevance'),
      reason: getField(block, 'Reason'),
      ...(summary ? { summary } : {}),
      ...(promoted_to !== undefined ? { promoted_to } : {}),
    };
  });
}

export function readObservations(repoRoot, date) {
  const filePath = observationFilePath(repoRoot, date);
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, 'utf8');
  return readObservationsFromRaw(raw);
}

export function deleteObservation(repoRoot, date, signature) {
  const filePath = observationFilePath(repoRoot, date);
  if (!existsSync(filePath)) return false;

  const raw = readFileSync(filePath, 'utf8');
  const markers = collectMarkers(raw);
  const targetIdx = markers.findIndex((mk) => mk.signature === signature);
  if (targetIdx === -1) return false;

  const start = markers[targetIdx].index;
  const end = targetIdx + 1 < markers.length ? markers[targetIdx + 1].index : raw.length;

  writeFileSync(filePath, raw.slice(0, start) + raw.slice(end), 'utf8');
  return true;
}

export function demoteObservation(repoRoot, date, signature) {
  const filePath = observationFilePath(repoRoot, date);
  if (!existsSync(filePath)) return false;

  const raw = readFileSync(filePath, 'utf8');
  const target = `<!-- obs:${signature} tier:promoted -->`;
  if (!raw.includes(target)) return false;

  writeFileSync(filePath, raw.replace(target, `<!-- obs:${signature} tier:observed -->`), 'utf8');
  return true;
}
