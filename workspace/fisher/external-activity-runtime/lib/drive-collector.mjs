import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ingestActivityEvents } from '../../../../scripts/lib/activity-runner.mjs';
import {
  decodeHtmlEntities,
  ensureDir,
  excerpt,
  htmlToText,
  lower,
  normalizeText,
  readJson,
  stableHash,
  writeJson,
  writeTextFile,
} from './collector-utils.mjs';
import { GoogleServiceAccountAuth } from './google-auth.mjs';

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/presentations.readonly',
];

const TEXT_DOWNLOAD_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/xml',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
]);

const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeDriveFile(entry) {
  if (entry?.file && typeof entry.file === 'object') return entry.file;
  return entry;
}

function driveFileId(entry) {
  return String(firstPresent(entry?.id, entry?.fileId, entry?.file_id) ?? '').trim();
}

function driveFileTitle(entry) {
  return firstPresent(entry?.title, entry?.name, entry?.fileName, driveFileId(entry), 'Drive file');
}

function driveFileUrl(entry) {
  return firstPresent(entry?.webViewLink, entry?.url, entry?.link, entry?.webUrl, entry?.alternateLink, '');
}

function driveFileChangedAt(entry, fallback) {
  return firstPresent(entry?.modifiedTime, entry?.modifiedDate, entry?.time, entry?.timestamp, fallback, new Date().toISOString());
}

function driveActor(entry) {
  const lastModifyingUser = entry?.lastModifyingUser ?? {};
  const owner = Array.isArray(entry?.owners) ? entry.owners[0] ?? {} : {};
  return {
    name: firstPresent(lastModifyingUser?.displayName, owner?.displayName, entry?.modifiedByName, entry?.ownerName, 'unknown'),
    email: lower(firstPresent(lastModifyingUser?.emailAddress, owner?.emailAddress, entry?.modifiedByEmail, entry?.ownerEmail, '')),
  };
}

function mapDriveActorToMember(config, entry) {
  const actor = driveActor(entry);
  if (!actor.email) return null;
  for (const [memberKey, member] of Object.entries(config.members ?? {})) {
    const emails = (member?.drive_emails ?? []).map(lower).filter(Boolean);
    if (emails.includes(actor.email)) return memberKey;
  }
  return null;
}

function isGoogleDocMimeType(mimeType) {
  return mimeType === 'application/vnd.google-apps.document';
}

function isGoogleSheetMimeType(mimeType) {
  return mimeType === 'application/vnd.google-apps.spreadsheet';
}

function isGoogleSlideMimeType(mimeType) {
  return mimeType === 'application/vnd.google-apps.presentation';
}

function shouldAttemptBinaryDownload(file) {
  const mimeType = String(file?.mimeType ?? '');
  return mimeType.startsWith('text/') || TEXT_DOWNLOAD_MIME_TYPES.has(mimeType) || mimeType === 'application/pdf' || mimeType === DOCX_MIME_TYPE;
}

function isAllowlisted({ file, allowlistedFileIds, allowlistedFolderIds, allowlistedDriveIds }) {
  const fileId = driveFileId(file);
  if (allowlistedFileIds.size === 0 && allowlistedFolderIds.size === 0 && allowlistedDriveIds.size === 0) {
    return true;
  }
  if (allowlistedFileIds.has(fileId)) return true;
  if (file?.driveId && allowlistedDriveIds.has(file.driveId)) return true;
  const parents = Array.isArray(file?.parents) ? file.parents : [];
  if (parents.some((parentId) => allowlistedFolderIds.has(parentId))) return true;
  return false;
}

function collectDocTextNodes(nodes, bucket) {
  for (const node of nodes ?? []) {
    if (node?.paragraph?.elements) {
      for (const element of node.paragraph.elements) {
        const textRun = element?.textRun?.content;
        if (textRun) bucket.push(textRun);
      }
    }
    if (node?.table?.tableRows) {
      for (const row of node.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          collectDocTextNodes(cell.content ?? [], bucket);
        }
      }
    }
    if (node?.tableOfContents?.content) {
      collectDocTextNodes(node.tableOfContents.content, bucket);
    }
  }
}

function collectSlidesText(presentation) {
  const blocks = [];
  for (const slide of presentation?.slides ?? []) {
    const lines = [];
    for (const element of slide.pageElements ?? []) {
      for (const textElement of element?.shape?.text?.textElements ?? []) {
        const content = textElement?.textRun?.content;
        if (content) lines.push(content);
      }
    }
    const normalized = lines.join('').replace(/\s+\n/g, '\n').trim();
    if (normalized) blocks.push(normalized);
  }
  return blocks.join('\n\n').trim();
}

function officeXmlToText(xml) {
  return normalizeText(
    decodeHtmlEntities(
      String(xml ?? '')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<\/w:tr>/g, '\n')
        .replace(/<\/w:tc>/g, '\t')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
  );
}

function extractDocxTextFromBinary(binary) {
  const workDir = mkdtempSync(resolve(tmpdir(), 'drive-docx-'));
  const docPath = resolve(workDir, 'input.docx');
  try {
    writeFileSync(docPath, binary);
    const xml = execFileSync('unzip', ['-p', docPath, 'word/document.xml'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return officeXmlToText(xml);
  } catch {
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export class DriveCollector {
  constructor({
    repoRoot,
    config,
    fetchImpl = fetch,
    ingestEvents = ingestActivityEvents,
    auth = null,
    officeTextExtractor = extractDocxTextFromBinary,
  }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.ingestEvents = ingestEvents;
    this.collectorConfig = config.drive ?? {};
    this.statePath = resolve(repoRoot, this.collectorConfig.state_path ?? '.runtime/drive-collector/state.json');
    this.rawEventDir = resolve(repoRoot, this.collectorConfig.raw_event_dir ?? '.runtime/drive-collector/raw');
    this.fileCacheDir = resolve(repoRoot, this.collectorConfig.file_cache_dir ?? '.runtime/drive-collector/files');
    this.auth = auth ?? new GoogleServiceAccountAuth({
      scopes: DRIVE_SCOPES,
      fetchImpl,
    });
    this.officeTextExtractor = officeTextExtractor;
  }

  readState() {
    return readJson(this.statePath, {
      files: {},
      page_token: null,
      start_page_token: null,
      new_start_page_token: null,
      streams: {},
    });
  }

  writeState(state) {
    writeJson(this.statePath, state);
  }

  async authorizedFetch(url, init = {}) {
    const token = await this.auth.accessToken();
    const response = await this.fetchImpl(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Google API request failed with ${response.status}: ${url}`);
    }
    return response;
  }

  async googleJson(url, init = {}) {
    const response = await this.authorizedFetch(url, init);
    return response.json();
  }

  async driveApi(path, params = {}) {
    const url = new URL(path, 'https://www.googleapis.com/');
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return this.googleJson(url);
  }

  streamKey(driveId = null) {
    return driveId ? `shared:${driveId}` : 'default';
  }

  streamState(state, driveId = null) {
    state.streams ??= {};
    const key = this.streamKey(driveId);
    if (!state.streams[key]) {
      state.streams[key] = {
        page_token: driveId ? null : state.page_token ?? null,
        start_page_token: driveId ? null : state.start_page_token ?? null,
        new_start_page_token: driveId ? null : state.new_start_page_token ?? null,
      };
    }
    return state.streams[key];
  }

  syncLegacyState(state) {
    const fallback = state.streams?.default ?? {};
    state.page_token = fallback.page_token ?? state.page_token ?? null;
    state.start_page_token = fallback.start_page_token ?? state.start_page_token ?? null;
    state.new_start_page_token = fallback.new_start_page_token ?? state.new_start_page_token ?? null;
  }

  async fetchStartPageToken(driveId = null) {
    const payload = await this.driveApi('/drive/v3/changes/startPageToken', {
      supportsAllDrives: true,
      driveId: driveId ?? undefined,
    });
    return payload.startPageToken;
  }

  async listChanges(pageToken, driveId = null) {
    return this.driveApi('/drive/v3/changes', {
      pageToken,
      pageSize: Math.max(1, Number(this.collectorConfig.max_changes_per_poll ?? this.collectorConfig.max_files_per_poll ?? 25)),
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: driveId ? 'drive' : undefined,
      driveId: driveId ?? undefined,
      fields: 'changes(fileId,removed,time,file(id,name,mimeType,modifiedTime,webViewLink,parents,driveId,size,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),trashed)),newStartPageToken,nextPageToken',
    });
  }

  async fetchFile(fileId) {
    return this.driveApi(`/drive/v3/files/${encodeURIComponent(fileId)}`, {
      supportsAllDrives: true,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,parents,driveId,size,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),trashed',
    });
  }

  async detectFolderDriveId(folderId) {
    try {
      const folder = await this.fetchFile(folderId);
      return folder?.driveId ?? null;
    } catch {
      return null;
    }
  }

  async listRecentFiles({ driveId = null, modifiedTimeMin = null, folderId = null, pageToken = null }) {
    const params = {
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: driveId ? 'drive' : undefined,
      driveId: driveId ?? undefined,
      pageSize: Math.max(1, Number(this.collectorConfig.max_files_per_poll ?? 25)),
      orderBy: 'modifiedTime desc',
      pageToken: pageToken ?? undefined,
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents,driveId,size,owners(displayName,emailAddress),lastModifyingUser(displayName,emailAddress),trashed),nextPageToken',
    };
    const queryParts = ['trashed=false'];
    if (modifiedTimeMin) queryParts.push(`modifiedTime > '${modifiedTimeMin}'`);
    if (folderId) queryParts.push(`'${folderId}' in parents`);
    params.q = queryParts.join(' and ');
    return this.driveApi('/drive/v3/files', params);
  }

  async listFolderFiles({ folderId, driveId = null, modifiedTimeMin = null }) {
    const files = [];
    let pageToken = null;
    do {
      const payload = await this.listRecentFiles({ driveId, modifiedTimeMin, folderId, pageToken });
      files.push(...(payload?.files ?? []));
      pageToken = payload?.nextPageToken ?? null;
    } while (pageToken);
    return files;
  }

  async fetchDocText(fileId) {
    const payload = await this.googleJson(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}?includeTabsContent=true`);
    const tabs = payload?.tabs ?? [];
    if (tabs.length === 0) {
      const chunks = [];
      collectDocTextNodes(payload?.body?.content ?? [], chunks);
      return chunks.join('').replace(/\s+\n/g, '\n').trim();
    }
    const blocks = [];
    for (const tab of tabs) {
      const title = tab?.tabProperties?.title;
      const content = tab?.documentTab?.body?.content ?? [];
      const chunks = [];
      collectDocTextNodes(content, chunks);
      const text = chunks.join('').replace(/\s+\n/g, '\n').trim();
      if (!text) continue;
      blocks.push(title ? `# ${title}\n${text}` : text);
    }
    return blocks.join('\n\n').trim();
  }

  async fetchSpreadsheetText(fileId) {
    const metadata = await this.googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=properties.title,sheets.properties.title`);
    const sheets = metadata?.sheets ?? [];
    const blocks = [];
    for (const sheet of sheets.slice(0, Math.max(1, Number(this.collectorConfig.max_sheets_per_file ?? 10)))) {
      const title = sheet?.properties?.title;
      if (!title) continue;
      const range = encodeURIComponent(`'${String(title).replace(/'/g, "''")}'`);
      const valuesPayload = await this.googleJson(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${range}`);
      const rows = valuesPayload?.values ?? [];
      if (rows.length === 0) continue;
      blocks.push(`# ${title}\n${rows.map((row) => row.join('\t')).join('\n')}`);
    }
    return blocks.join('\n\n').trim();
  }

  async fetchSlidesText(fileId) {
    const payload = await this.googleJson(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`);
    return collectSlidesText(payload);
  }

  async downloadBinary(file) {
    const fileId = driveFileId(file);
    const size = Number(file?.size ?? 0);
    const maxBytes = Number(this.collectorConfig.file_download_max_bytes ?? 5 * 1024 * 1024);
    if (!size || size > maxBytes) return null;
    const response = await this.authorizedFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
      headers: {
        Accept: '*/*',
      },
    });
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async extractText(file) {
    const mimeType = String(file?.mimeType ?? '');
    if (isGoogleDocMimeType(mimeType)) {
      return { text: await this.fetchDocText(driveFileId(file)), binary: null, binaryExt: null };
    }
    if (isGoogleSheetMimeType(mimeType)) {
      return { text: await this.fetchSpreadsheetText(driveFileId(file)), binary: null, binaryExt: null };
    }
    if (isGoogleSlideMimeType(mimeType)) {
      return { text: await this.fetchSlidesText(driveFileId(file)), binary: null, binaryExt: null };
    }

    if (shouldAttemptBinaryDownload(file)) {
      const binary = await this.downloadBinary(file);
      if (!binary) return { text: null, binary: null, binaryExt: null };
      if (mimeType === 'application/pdf') {
        return { text: null, binary, binaryExt: '.pdf' };
      }
      if (mimeType === DOCX_MIME_TYPE) {
        const text = this.officeTextExtractor(binary);
        return text ? { text, binary: null, binaryExt: null } : { text: null, binary, binaryExt: '.docx' };
      }
      const rawText = binary.toString('utf8');
      const text = mimeType === 'text/html' ? htmlToText(rawText) : rawText.trim();
      return { text, binary: null, binaryExt: null };
    }

    return { text: null, binary: null, binaryExt: null };
  }

  writeRawJson(fileId, value) {
    const path = resolve(this.rawEventDir, 'files', `${fileId}.json`);
    writeJson(path, value);
    return path;
  }

  writeBinary(fileId, ext, content) {
    const path = resolve(this.fileCacheDir, `${fileId}${ext}`);
    ensureDir(this.fileCacheDir);
    writeFileSync(path, content);
    return path;
  }

  async trackFile({ file, changedAt, state, events }) {
    const fileId = driveFileId(file);
    if (!fileId) return;

    const rawPath = this.writeRawJson(fileId, file);
    const extracted = await this.extractText(file);
    let rawRef = rawPath;
    if (extracted?.text) rawRef = writeTextFile(resolve(this.fileCacheDir, `${fileId}.txt`), extracted.text);
    if (extracted?.binary && extracted?.binaryExt) rawRef = this.writeBinary(fileId, extracted.binaryExt, extracted.binary);

    const fingerprint = stableHash({
      name: driveFileTitle(file),
      mime_type: file.mimeType,
      changed_at: changedAt,
      text: extracted?.text ?? null,
      size: file?.size ?? null,
      trashed: file?.trashed ?? false,
    });
    if (state.files?.[fileId]?.fingerprint === fingerprint) return;

    const actor = driveActor(file);
    const workspaceOwner = mapDriveActorToMember(this.config, file) ?? 'jared';
    events.push({
      source: 'drive',
      object_type: 'drive-file',
      object_id: fileId,
      object_title: driveFileTitle(file),
      object_url: driveFileUrl(file),
      actor: actor.name,
      workspace_owner: workspaceOwner,
      changed_at: changedAt,
      native_change_id: `${fileId}-${changedAt}`,
      summary: `Google Drive file updated: ${driveFileTitle(file)}${extracted?.text ? ` | Content: ${excerpt(extracted.text, 180)}` : ''}`,
      raw_ref: rawRef,
    });
    state.files[fileId] = {
      fingerprint,
      changed_at: changedAt,
      last_polled_at: new Date().toISOString(),
    };
  }

  async backfillRecentFiles({ driveId = null, state, events, allowlistedDriveIds, allowlistedFolderIds, allowlistedFileIds }) {
    const lookbackHours = Math.max(0, Number(this.collectorConfig.initial_lookback_hours ?? 168));
    if (!lookbackHours) return;
    const modifiedTimeMin = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();

    const seen = new Set();
    const processFile = async (file) => {
      if (!file?.id || file?.trashed) return;
      if (seen.has(file.id)) return;
      seen.add(file.id);
      if (!isAllowlisted({ file, allowlistedFileIds, allowlistedFolderIds, allowlistedDriveIds })) return;
      await this.trackFile({
        file,
        changedAt: driveFileChangedAt(file),
        state,
        events,
      });
    };

    const payload = await this.listRecentFiles({ driveId, modifiedTimeMin });
    for (const file of payload?.files ?? []) {
      await processFile(file);
    }

    for (const folderId of allowlistedFolderIds) {
      const folderDriveId = await this.detectFolderDriveId(folderId);
      if (driveId && folderDriveId !== driveId) continue;
      if (!driveId && folderDriveId) continue;
      const files = await this.listFolderFiles({ folderId, driveId: folderDriveId ?? driveId, modifiedTimeMin });
      for (const file of files) {
        await processFile(file);
      }
    }
  }

  async pollOnce() {
    if (this.collectorConfig.enabled === false) {
      return { enabled: false, event_count: 0, candidate_count: 0, log_results: [] };
    }
    if ((this.collectorConfig.mode ?? 'google_api') !== 'google_api') {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'unsupported_mode' };
    }
    if (!this.auth?.isConfigured?.()) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'missing_credentials' };
    }

    const state = this.readState();
    state.files ??= {};
    state.streams ??= {};

    const allowlistedDriveIds = new Set(this.collectorConfig.shared_drives ?? []);
    const allowlistedFolderIds = new Set(this.collectorConfig.folders ?? []);
    const allowlistedFileIds = new Set(this.collectorConfig.files ?? []);
    const driveIds = [...allowlistedDriveIds];
    const streams = [{ driveId: null }, ...driveIds.map((driveId) => ({ driveId }))];
    const events = [];
    let initializedAnyStream = false;

    for (const { driveId } of streams) {
      const streamState = this.streamState(state, driveId);
      if (!streamState.page_token) {
        const startToken = await this.fetchStartPageToken(driveId);
        streamState.start_page_token = startToken;
        streamState.page_token = startToken;
        streamState.new_start_page_token = startToken;
        await this.backfillRecentFiles({
          driveId,
          state,
          events,
          allowlistedDriveIds,
          allowlistedFolderIds,
          allowlistedFileIds,
        });
        initializedAnyStream = true;
        continue;
      }

      const payload = await this.listChanges(streamState.page_token, driveId);
      for (const change of payload?.changes ?? []) {
        if (change?.removed) continue;
        let file = normalizeDriveFile(change?.file);
        if (!file?.id && change?.fileId) {
          try {
            file = await this.fetchFile(change.fileId);
          } catch {
            continue;
          }
        }
        if (!file?.id || file?.trashed) continue;
        if (!isAllowlisted({ file, allowlistedFileIds, allowlistedFolderIds, allowlistedDriveIds })) continue;
        await this.trackFile({
          file,
          changedAt: driveFileChangedAt(file, change?.time),
          state,
          events,
        });
      }
      streamState.page_token = payload?.nextPageToken || payload?.newStartPageToken || streamState.page_token;
      if (payload?.newStartPageToken) {
        streamState.new_start_page_token = payload.newStartPageToken;
        streamState.start_page_token = payload.newStartPageToken;
      }
    }

    this.syncLegacyState(state);
    this.writeState(state);

    if (initializedAnyStream && events.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'initialized_start_page_token' };
    }
    if (events.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [] };
    }
    return this.ingestEvents({ repoRoot: this.repoRoot, events });
  }
}

export function startDriveCollector({ collector, intervalSeconds, logger = console }) {
  const seconds = Math.max(60, Number(intervalSeconds ?? 600));
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await collector.pollOnce();
      logger.log?.(`[drive-collector] poll complete: ${result.event_count} event(s), ${result.candidate_count} candidate(s)${result.reason ? ` (${result.reason})` : ''}`);
      if (result.candidates?.length) {
        for (const c of result.candidates) {
          logger.log?.(`[drive-collector]   candidate: type=${c.candidate_type} key=${c.candidate_key} signal=${c.signal_score ?? '-'} artifact=${c.artifact_type ?? '-'}`);
        }
      }
    } catch (error) {
      logger.error?.(`[drive-collector] poll failed: ${error.message}`);
    } finally {
      inFlight = false;
    }
  };

  setInterval(() => {
    void tick();
  }, seconds * 1000);

  return tick();
}
