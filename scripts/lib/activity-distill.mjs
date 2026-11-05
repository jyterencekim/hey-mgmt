import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { parseArtifact, writeArtifact } from './content-io.mjs';
import { scaffoldArtifact, slugify } from './scaffold.mjs';
import { followLinks } from './link-extractor.mjs';

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean))];
}

function repoRelativePath(repoRoot, path) {
  if (!path) return null;
  const absolute = resolve(path);
  const repoAbsolute = resolve(repoRoot);
  if (!absolute.startsWith(repoAbsolute)) return null;
  return relative(repoAbsolute, absolute).split('\\').join('/');
}

function readTextFile(path) {
  try {
    return normalizeWhitespace(readFileSync(path, 'utf8'));
  } catch {
    return '';
  }
}

function collectJsonStrings(value, bucket = [], depth = 0) {
  if (depth > 4 || bucket.length >= 30) return bucket;
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(value);
    if (normalized) bucket.push(normalized);
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

export function readRawSourceText(rawRef) {
  if (!rawRef || !existsSync(rawRef)) return '';
  const extension = extname(rawRef).toLowerCase();
  if (extension !== '.json') return readTextFile(rawRef);

  try {
    const parsed = JSON.parse(readFileSync(rawRef, 'utf8'));
    return uniqueNonEmpty(collectJsonStrings(parsed)).join('\n\n');
  } catch {
    return '';
  }
}

function keywordMatches(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => lower.includes(keyword));
}

function sourceBaseScore(event) {
  if (event.source === 'confluence' || event.source === 'drive') return 2;
  if (event.source === 'jira') return 2;
  if (event.source === 'slack' && event.object_type === 'slack-thread') return 1;
  if (event.source === 'slack' && event.object_type === 'slack-file') return 1;
  return 0;
}

function signalAssessment_ruleBased(event, sourceText, minSignalScore) {
  const combined = normalizeWhitespace([event.object_title, event.summary, sourceText].filter(Boolean).join('\n\n'));
  const lower = combined.toLowerCase();
  const decisionHits = keywordMatches(lower, ['decision', 'decide', 'policy', 'rationale', 'approved', 'adr']);
  const playbookHits = keywordMatches(lower, ['playbook', 'runbook', 'how to', 'how-to', 'procedure', 'steps', 'troubleshooting', 'checklist']);
  const taskHits = keywordMatches(lower, ['todo', 'to do', 'action item', 'follow up', 'follow-up', 'next step', 'owner', 'deadline', 'due', 'blocker', 'implement', 'ship']);

  let score = sourceBaseScore(event);
  const reasons = [];

  if (score > 0) reasons.push(`source_base=${score}`);
  if (event.content_hint) {
    score += 2;
    reasons.push('content_hint');
  }
  if (sourceText.length >= 200) {
    score += 1;
    reasons.push('source_text>=200');
  }
  if (sourceText.length >= 800) {
    score += 1;
    reasons.push('source_text>=800');
  }
  if (/^[-*#]|\n\d+\./m.test(sourceText)) {
    score += 1;
    reasons.push('structured_text');
  }
  if (decisionHits.length > 0 || playbookHits.length > 0 || taskHits.length > 0) {
    score += 2;
    reasons.push('knowledge_keywords');
  }
  if (event.source === 'slack' && event.object_type === 'slack-message' && sourceText.length < 80 && taskHits.length === 0 && decisionHits.length === 0 && playbookHits.length === 0) {
    score -= 2;
    reasons.push('short_slack_message_penalty');
  }

  return {
    score,
    selected: score >= minSignalScore,
    reasons,
    decisionHits,
    playbookHits,
    taskHits,
    combinedText: combined,
  };
}

function inferArtifactType_ruleBased(event, assessment, sourceText) {
  if (event.source === 'jira' || event.content_hint?.status) return 'task';
  if (sourceText.length >= 80 && event.source !== 'slack' && assessment.decisionHits.length > 0) return 'decision';
  if (sourceText.length >= 80 && assessment.playbookHits.length > 0) return 'playbook';
  if (assessment.taskHits.length > 0) return 'task';
  return 'note';
}

function cleanTitleCandidate(event) {
  let title = normalizeWhitespace(event.object_title || event.summary || `${event.source} ${event.object_id}`);
  title = title.replace(/^#[^\s]+\s+/, '');
  title = title.replace(/^Slack (message|thread|file) in #[^:]+:\s*/i, '');
  return title || `${event.source} ${event.object_id}`;
}

function buildArtifactTitle(event, artifactType) {
  const base = cleanTitleCandidate(event);
  if (artifactType === 'decision') return base.startsWith('ADR:') ? base : `ADR: ${base}`;
  if (artifactType === 'playbook') return /^how to:|^playbook:/i.test(base) ? base : `How to: ${base}`;
  return base;
}

function extractHighlights_ruleBased(sourceText, summary, limit = 3) {
  const candidates = uniqueNonEmpty([
    ...String(sourceText ?? '')
      .split(/\n+/)
      .map((line) => line.replace(/^[-*#\d.\s]+/, '').trim()),
    ...String(sourceText ?? '')
      .split(/[.!?]\s+/)
      .map((line) => line.trim()),
    summary,
  ])
    .filter((line) => line.length >= 24 && line.length <= 220)
    .filter((line) => !/^https?:\/\//i.test(line))
    .slice(0, 12);

  return candidates.slice(0, limit);
}

function relativeSourceRef(repoRoot, event, mirrorRelativePath = null) {
  if (mirrorRelativePath) {
    return { kind: 'doc', ref: mirrorRelativePath, title: `${event.source} mirror for ${cleanTitleCandidate(event)}` };
  }

  const rawRelative = repoRelativePath(repoRoot, event.raw_ref);
  if (rawRelative) {
    return { kind: 'doc', ref: rawRelative, title: `${event.source} raw cache for ${cleanTitleCandidate(event)}` };
  }

  return null;
}

function buildSources(repoRoot, event, mirrorRelativePath = null) {
  const sources = [];
  if (event.object_url) {
    sources.push({
      url: event.object_url,
      title: `${event.source} source: ${cleanTitleCandidate(event)}`,
    });
  }
  const refSource = relativeSourceRef(repoRoot, event, mirrorRelativePath);
  if (refSource) sources.push(refSource);
  return sources;
}

function buildCommonFrontmatter(repoRoot, candidate, event, artifactType, mirrorRelativePath = null) {
  const owner = 'alice';
  const frontmatter = {
    owner,
    sources: buildSources(repoRoot, event, mirrorRelativePath),
    x_external_refs: [{ source: event.source, object_id: event.object_id }],
    x_distilled_from_candidate: candidate.id,
  };

  if (artifactType === 'task') {
    frontmatter.status = 'plan';
    frontmatter.definition_of_done = [
      'Review and refine the distilled task scope',
      `${buildArtifactTitle(event, artifactType)} is complete`,
    ];
  }

  if (artifactType === 'decision') {
    frontmatter.status = 'active';
    frontmatter.decision_status = 'proposed';
    frontmatter.owners = [owner];
  }

  if (artifactType === 'playbook') {
    frontmatter.status = 'active';
    frontmatter.playbook_version = '1.0.0';
  }

  if (artifactType === 'note') {
    frontmatter.status = 'active';
  }

  return frontmatter;
}

function buildDraftBody(event, artifactType, assessment, highlights) {
  const sourceRef = `${event.source}:${event.object_id}`;
  const intro = `Auto-distilled from external ${event.source} activity. Human approval is still required before relying on this as durable team context.`;

  if (artifactType === 'task') {
    return [
      '## Context',
      intro,
      '',
      '## Distilled Summary',
      ...highlights.map((line) => `- ${line}`),
      '',
      '## Definition of Done',
      '- [ ] Review and refine the distilled task scope',
      '- [ ] Complete the follow-up captured in the external source',
      '',
      '## Source Trace',
      `- External ref: \`${sourceRef}\``,
      `- URL: ${event.object_url || '-'}`,
      `- Selection score: ${assessment.score}`,
    ].join('\n');
  }

  if (artifactType === 'decision') {
    return [
      '## Context',
      intro,
      '',
      '## Decision',
      ...highlights.map((line) => `- ${line}`),
      '',
      '## Consequences',
      '- Validate and refine this distilled decision before relying on it in implementation.',
      '',
      '## Alternatives Considered',
      '- Not yet distilled from the external source.',
      '',
      '## Source Trace',
      `- External ref: \`${sourceRef}\``,
      `- URL: ${event.object_url || '-'}`,
      `- Selection score: ${assessment.score}`,
    ].join('\n');
  }

  if (artifactType === 'playbook') {
    return [
      '## Purpose',
      intro,
      '',
      '## Steps',
      ...highlights.map((line, index) => `${index + 1}. ${line}`),
      '',
      '## Troubleshooting',
      '- Review the linked source and adjust the steps if the external procedure changes.',
      '',
      '## Source Trace',
      `- External ref: \`${sourceRef}\``,
      `- URL: ${event.object_url || '-'}`,
      `- Selection score: ${assessment.score}`,
    ].join('\n');
  }

  return [
    '## Context',
    intro,
    '',
    '## Content',
    '### Distilled Summary',
    ...highlights.map((line) => `- ${line}`),
    '',
    '### Source Trace',
    `- External ref: \`${sourceRef}\``,
    `- URL: ${event.object_url || '-'}`,
    `- Selection score: ${assessment.score}`,
  ].join('\n');
}

function ensureReferenceMirror(repoRoot, event, sourceText) {
  if (!['confluence', 'drive'].includes(event.source) || !sourceText) return null;
  const slug = slugify(cleanTitleCandidate(event)).slice(0, 30) || event.object_id.toLowerCase();
  const safeObjectId = slugify(String(event.object_id)).slice(0, 24) || 'external';
  const relativePath = `docs/references/${event.source}-${safeObjectId}-${slug}.md`;
  const absolutePath = resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    mkdirSync(dirname(absolutePath), { recursive: true });
    const content = [
      `# ${cleanTitleCandidate(event)}`,
      '',
      `- Source: ${event.source}`,
      `- Object ID: ${event.object_id}`,
      `- URL: ${event.object_url || '-'}`,
      `- Synced At: ${event.changed_at}`,
      '',
      '## Extracted Content',
      '',
      sourceText,
      '',
    ].join('\n');
    writeFileSync(absolutePath, content, 'utf8');
  }
  return relativePath;
}

// assessDistillCandidate is no longer used — the Hermes agent handles all
// classification natively via the prepare-candidates → agent → finalize-candidates
// pipeline. Kept as a no-op for backward compatibility with any callers.
export async function assessDistillCandidate() {
  return { selected: false, suppress_candidate: false };
}

export function materializeDistillCandidate({ repoRoot, candidate }) {
  const latest = [...(candidate.events ?? [])].sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at)).at(-1);
  if (!latest) throw new Error(`candidate ${candidate.id} has no events`);
  const artifactType = candidate.draft?.type ?? candidate.suggested_artifact?.type ?? 'note';
  const artifactTitle = candidate.draft?.title ?? candidate.suggested_artifact?.title ?? cleanTitleCandidate(latest);
  const sourceText = normalizeWhitespace(candidate.draft?.preview_source_text || readRawSourceText(latest.raw_ref));
  const mirrorRelativePath = ensureReferenceMirror(repoRoot, latest, sourceText);
  const extraFields = buildCommonFrontmatter(repoRoot, candidate, latest, artifactType, mirrorRelativePath);

  const scaffolded = scaffoldArtifact({
    repoRoot,
    type: artifactType,
    title: artifactTitle,
    extraFields,
    domain: candidate.domain_tag,
  });

  const parsed = parseArtifact(scaffolded.path, resolve(repoRoot, 'content'));
  writeArtifact(scaffolded.path, parsed.frontmatter, candidate.draft?.body ?? buildDraftBody(latest, artifactType, { score: candidate.signal_score ?? 0 }, extractHighlights_ruleBased(sourceText, latest.summary)));

  return {
    artifact_id: parsed.id,
    artifact_path: scaffolded.relativePath,
    mirror_path: mirrorRelativePath,
  };
}
