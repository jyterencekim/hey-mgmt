import { resolve } from 'node:path';
import { parseArtifact, readArtifacts, writeArtifact } from '../content-io.mjs';
import { scaffoldArtifact } from '../scaffold.mjs';
import { matchMeetingSnapshot } from './matcher.mjs';
import { extractTaskLines, parseH2Sections, serializeMeetingBody } from './markdown.mjs';
import {
  formatKstDate,
  formatKstTime,
  lines,
  shortId,
  sourceUrlList,
  uniqueStrings,
} from './common.mjs';

function todayKst(timeZone = 'Asia/Seoul') {
  return formatKstDate(new Date().toISOString(), timeZone);
}

function hasMeetingFields(snapshot) {
  return Boolean(snapshot.title && snapshot.start_at && snapshot.end_at && (snapshot.attendees ?? []).length > 0);
}

function contentArtifacts(repoRoot) {
  return readArtifacts(resolve(repoRoot, 'content'));
}

function relationKey(relation) {
  return `${relation.type}:${relation.target}`;
}

function mergeRelations(existing, nextRelation) {
  const relations = Array.isArray(existing) ? [...existing] : [];
  if (!nextRelation) return relations;
  const seen = new Set(relations.map(relationKey));
  if (!seen.has(relationKey(nextRelation))) {
    relations.push(nextRelation);
  }
  return relations;
}

function mergeSources(existing, urls) {
  return uniqueStrings([...(Array.isArray(existing) ? existing : []), ...sourceUrlList({ source_urls: urls })]);
}

function buildManagedSources(snapshot) {
  return sourceUrlList(snapshot).map((url) => url);
}

function defaultContext(snapshot) {
  const sourceName = snapshot.source === 'notion' ? 'Notion meeting DB' : 'Gmail/Google meeting note';
  const status = snapshot.parse_status ? ` (${snapshot.parse_status})` : '';
  return `Imported from ${sourceName}${status}.`;
}

function actionItemsFromSection(content) {
  return extractTaskLines(content).length > 0
    ? extractTaskLines(content)
    : lines(content)
        .map((line) => line.trim().replace(/^[-*]\s+/, ''))
        .filter(Boolean);
}

function buildMeetingScaffoldTitle(snapshot) {
  const date = formatKstDate(snapshot.start_at ?? snapshot.updated_at ?? new Date().toISOString()) ?? 'meeting';
  const time = formatKstTime(snapshot.start_at ?? snapshot.updated_at ?? new Date().toISOString()) ?? shortId(snapshot.gmail_message_id ?? snapshot.google_doc_id ?? snapshot.notion_page_id);
  return `${date} ${time} ${snapshot.title}`;
}

function buildStubScaffoldTitle(snapshot) {
  const marker = shortId(snapshot.gmail_message_id ?? snapshot.google_doc_id ?? snapshot.notion_page_id ?? snapshot.external_id);
  return `${marker} ${snapshot.title || 'meeting-stub'}`;
}

function parseCreatedArtifact(repoRoot, artifactPath) {
  return parseArtifact(artifactPath, resolve(repoRoot, 'content'));
}

function writeMeetingLikeArtifact({
  repoRoot,
  existingArtifact = null,
  type,
  title,
  extraFields,
  body,
  dryRun,
}) {
  if (existingArtifact) {
    if (!dryRun) {
      writeArtifact(existingArtifact.filePath, extraFields, body);
    }
    return {
      action: 'updated',
      artifact_id: existingArtifact.id,
      artifact_path: `content/${existingArtifact.relativePath}`,
      artifact_type: existingArtifact.type,
      body,
      frontmatter: extraFields,
    };
  }

  if (dryRun) {
    return {
      action: 'created',
      artifact_id: null,
      artifact_path: null,
      artifact_type: type,
      body,
      frontmatter: extraFields,
    };
  }

  const created = scaffoldArtifact({
    repoRoot,
    type,
    title,
    extraFields,
  });
  const parsed = parseCreatedArtifact(repoRoot, created.path);
  writeArtifact(parsed.filePath, { ...parsed.frontmatter, ...extraFields }, body);
  return {
    action: 'created',
    artifact_id: parsed.id,
    artifact_path: created.relativePath,
    artifact_type: type,
    body,
    frontmatter: { ...parsed.frontmatter, ...extraFields },
  };
}

function archiveStub({ stub, timeZone, dryRun }) {
  if (!stub || stub.frontmatter?.status === 'archived') return null;
  const nextFrontmatter = {
    ...stub.frontmatter,
    status: 'archived',
    updated_at: todayKst(timeZone),
  };
  if (!dryRun) {
    writeArtifact(stub.filePath, nextFrontmatter, stub.body);
  }
  return {
    action: 'archived_stub',
    artifact_id: stub.id,
    artifact_path: `content/${stub.relativePath}`,
    artifact_type: stub.type,
  };
}

function renderStubBody(snapshot) {
  const sourceLines = buildManagedSources(snapshot).map((url) => `- ${url}`).join('\n') || '- No source URLs captured.';
  return [
    '## Context',
    `Stub created from ${snapshot.source === 'notion' ? 'Notion' : 'Gmail'} import because required meeting fields are incomplete.`,
    '',
    '## Sources',
    sourceLines,
    '',
  ].join('\n');
}

function nextMeetingFrontmatter(existing, snapshot, config, stub) {
  const authority = snapshot.source === 'notion'
    ? 'notion'
    : (existing?.frontmatter?.x_source_authority ?? 'gmail');
  return {
    ...(existing?.frontmatter ?? {}),
    title: snapshot.title,
    type: 'meeting',
    updated_at: todayKst(config.defaults?.timezone),
    status: existing?.frontmatter?.status ?? config.defaults?.meeting_status ?? 'active',
    owner: snapshot.owner ?? existing?.frontmatter?.owner ?? config.defaults?.default_owner ?? 'jared',
    area: existing?.frontmatter?.area ?? config.defaults?.default_area ?? 'Team',
    attendees: snapshot.attendees,
    start_at: snapshot.start_at,
    end_at: snapshot.end_at,
    sources: mergeSources(existing?.frontmatter?.sources, buildManagedSources(snapshot)),
    relations: mergeRelations(existing?.frontmatter?.relations, stub ? { type: 'supersedes', target: stub.id } : null),
    x_calendar_event_id: snapshot.calendar_event_id ?? existing?.frontmatter?.x_calendar_event_id ?? null,
    x_google_doc_id: snapshot.google_doc_id ?? existing?.frontmatter?.x_google_doc_id ?? null,
    x_gmail_message_id: snapshot.gmail_message_id ?? existing?.frontmatter?.x_gmail_message_id ?? null,
    x_notion_page_id: snapshot.notion_page_id ?? existing?.frontmatter?.x_notion_page_id ?? null,
    x_source_authority: authority,
    x_last_synced_from: snapshot.source,
    x_last_synced_at: new Date().toISOString(),
    x_sync_parse_status: snapshot.parse_status ?? 'ready',
    x_external_attendees: uniqueStrings(snapshot.external_attendees),
    x_source_urls: buildManagedSources(snapshot),
  };
}

function nextStubFrontmatter(existing, snapshot, config) {
  return {
    ...(existing?.frontmatter ?? {}),
    title: snapshot.title || existing?.title || 'Meeting Stub',
    type: 'note',
    updated_at: todayKst(config.defaults?.timezone),
    status: config.defaults?.note_status ?? 'active',
    owner: snapshot.owner ?? existing?.frontmatter?.owner ?? config.defaults?.default_owner ?? 'jared',
    area: existing?.frontmatter?.area ?? config.defaults?.default_area ?? 'Team',
    sources: mergeSources(existing?.frontmatter?.sources, buildManagedSources(snapshot)),
    x_google_doc_id: snapshot.google_doc_id ?? existing?.frontmatter?.x_google_doc_id ?? null,
    x_gmail_message_id: snapshot.gmail_message_id ?? existing?.frontmatter?.x_gmail_message_id ?? null,
    x_notion_page_id: snapshot.notion_page_id ?? existing?.frontmatter?.x_notion_page_id ?? null,
    x_calendar_event_id: snapshot.calendar_event_id ?? existing?.frontmatter?.x_calendar_event_id ?? null,
    x_sync_parse_status: snapshot.parse_status ?? 'pending_fetch',
    x_source_urls: buildManagedSources(snapshot),
    x_last_synced_from: snapshot.source,
    x_last_synced_at: new Date().toISOString(),
    x_external_attendees: uniqueStrings(snapshot.external_attendees),
  };
}

function nextMeetingBody(existing, snapshot, canOverwriteManagedSections) {
  const parsed = existing ? parseH2Sections(existing.body) : { sections: new Map(), order: [] };
  const context = parsed.sections?.get('Context')?.trim() || defaultContext(snapshot);
  const notes = canOverwriteManagedSections
    ? (snapshot.notes_md?.trim() || '<!-- Imported meeting notes -->')
    : (parsed.sections?.get('Notes')?.trim() || '<!-- Imported meeting notes -->');
  const actionItems = canOverwriteManagedSections
    ? uniqueStrings(snapshot.action_items)
    : actionItemsFromSection(parsed.sections?.get('Action Items') ?? '');
  const sources = buildManagedSources(snapshot);
  const preserved = parsed.order
    .map((name) => [name, parsed.sections.get(name)])
    .filter(([name]) => !['Context', 'Notes', 'Action Items', 'Sources'].includes(name));

  return serializeMeetingBody({
    context,
    notes,
    actionItems,
    sources,
    preservedSections: preserved,
  });
}

function updateExistingMeetingMetadata({ meeting, snapshot, config, dryRun }) {
  const parsed = parseH2Sections(meeting.body);
  const frontmatter = {
    ...meeting.frontmatter,
    updated_at: todayKst(config.defaults?.timezone),
    sources: mergeSources(meeting.frontmatter?.sources, buildManagedSources(snapshot)),
    x_calendar_event_id: snapshot.calendar_event_id ?? meeting.frontmatter?.x_calendar_event_id ?? null,
    x_google_doc_id: snapshot.google_doc_id ?? meeting.frontmatter?.x_google_doc_id ?? null,
    x_gmail_message_id: snapshot.gmail_message_id ?? meeting.frontmatter?.x_gmail_message_id ?? null,
    x_notion_page_id: snapshot.notion_page_id ?? meeting.frontmatter?.x_notion_page_id ?? null,
    x_last_synced_from: snapshot.source,
    x_last_synced_at: new Date().toISOString(),
    x_sync_parse_status: snapshot.parse_status ?? meeting.frontmatter?.x_sync_parse_status ?? 'pending_fetch',
    x_external_attendees: uniqueStrings([...uniqueStrings(meeting.frontmatter?.x_external_attendees), ...uniqueStrings(snapshot.external_attendees)]),
    x_source_urls: uniqueStrings([...(meeting.frontmatter?.x_source_urls ?? []), ...buildManagedSources(snapshot)]),
  };
  const body = serializeMeetingBody({
    context: parsed.sections.get('Context') ?? defaultContext(snapshot),
    notes: parsed.sections.get('Notes') ?? '<!-- Imported meeting notes -->',
    actionItems: actionItemsFromSection(parsed.sections.get('Action Items') ?? ''),
    sources: buildManagedSources(snapshot),
    preservedSections: parsed.order
      .map((name) => [name, parsed.sections.get(name)])
      .filter(([name]) => !['Context', 'Notes', 'Action Items', 'Sources'].includes(name)),
  });

  if (!dryRun) {
    writeArtifact(meeting.filePath, frontmatter, body);
  }

  return {
    action: 'updated',
    artifact_id: meeting.id,
    artifact_path: `content/${meeting.relativePath}`,
    artifact_type: meeting.type,
    frontmatter,
    body,
  };
}

export function applyMeetingSnapshot({ repoRoot, config, snapshot, dryRun = false }) {
  const artifacts = contentArtifacts(repoRoot);
  const match = matchMeetingSnapshot({ snapshot, artifacts, config });

  if (!hasMeetingFields(snapshot)) {
    if (match.meeting) {
      return {
        result: updateExistingMeetingMetadata({ meeting: match.meeting, snapshot, config, dryRun }),
        archived_stub: null,
        match_strategy: match.strategy,
      };
    }

    const frontmatter = nextStubFrontmatter(match.stub, snapshot, config);
    const result = writeMeetingLikeArtifact({
      repoRoot,
      existingArtifact: match.stub,
      type: 'note',
      title: buildStubScaffoldTitle(snapshot),
      extraFields: frontmatter,
      body: renderStubBody(snapshot),
      dryRun,
    });
    return {
      result,
      archived_stub: null,
      match_strategy: match.strategy,
    };
  }

  const canOverwriteManagedSections = snapshot.source === 'notion'
    || match.meeting?.frontmatter?.x_source_authority !== 'notion';
  const frontmatter = nextMeetingFrontmatter(match.meeting, snapshot, config, match.stub);
  const body = nextMeetingBody(match.meeting, snapshot, canOverwriteManagedSections);
  const result = writeMeetingLikeArtifact({
    repoRoot,
    existingArtifact: match.meeting,
    type: 'meeting',
    title: buildMeetingScaffoldTitle(snapshot),
    extraFields: frontmatter,
    body,
    dryRun,
  });
  const archivedStub = archiveStub({ stub: match.stub, timeZone: config.defaults?.timezone, dryRun });
  return {
    result,
    archived_stub: archivedStub,
    match_strategy: match.strategy,
  };
}
