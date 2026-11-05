import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { ingestActivityEvents } from '../../../../scripts/lib/activity-runner.mjs';
import {
  ensureDir,
  excerpt,
  htmlToText,
  lower,
  readJson,
  stableHash,
  writeJson,
  writeTextFile,
} from './collector-utils.mjs';

function pageConfigId(page) {
  if (typeof page === 'string' || typeof page === 'number') return String(page);
  return String(page?.id ?? '').trim();
}

function pageUrl(baseUrl, page) {
  if (page?._links?.base && page?._links?.webui) return `${page._links.base}${page._links.webui}`;
  if (page?._links?.webui) return `${String(baseUrl).replace(/\/$/, '')}${page._links.webui}`;
  return `${String(baseUrl).replace(/\/$/, '')}/wiki/pages/viewpage.action?pageId=${page.id}`;
}

function mapActorToMember(config, actorName) {
  const normalizedActor = lower(actorName);
  for (const [memberKey, member] of Object.entries(config.members ?? {})) {
    const names = [memberKey, ...(member?.confluence_names ?? [])].map(lower).filter(Boolean);
    if (names.includes(normalizedActor)) return memberKey;
  }
  return null;
}

function pageActor(page) {
  return page?.history?.lastUpdated?.by?.displayName
    || page?.version?.by?.displayName
    || page?.history?.createdBy?.displayName
    || '';
}

function pageUpdatedAt(page) {
  return page?.history?.lastUpdated?.when
    || page?.version?.when
    || page?.history?.createdDate
    || new Date().toISOString();
}

export class ConfluenceCollector {
  constructor({
    repoRoot,
    config,
    fetchImpl = fetch,
    ingestEvents = ingestActivityEvents,
    email = process.env.ATLASSIAN_EMAIL,
    token = process.env.ATLASSIAN_API_TOKEN,
    baseUrl = process.env.ATLASSIAN_BASE_URL,
  }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.ingestEvents = ingestEvents;
    this.collectorConfig = config.confluence ?? {};
    this.email = email;
    this.token = token;
    this.baseUrl = String(baseUrl ?? '').replace(/\/$/, '');
    this.statePath = resolve(repoRoot, this.collectorConfig.state_path ?? '.runtime/confluence-collector/state.json');
    this.rawEventDir = resolve(repoRoot, this.collectorConfig.raw_event_dir ?? '.runtime/confluence-collector/raw');
    this.fileCacheDir = resolve(repoRoot, this.collectorConfig.file_cache_dir ?? '.runtime/confluence-collector/files');
  }

  readState() {
    return readJson(this.statePath, { pages: {} });
  }

  writeState(state) {
    writeJson(this.statePath, state);
  }

  authHeader() {
    const token = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    return `Basic ${token}`;
  }

  async api(path, params = {}) {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Authorization: this.authHeader(),
      },
    });
    if (!response.ok) {
      throw new Error(`Confluence API ${path} failed with ${response.status}`);
    }
    return response.json();
  }

  async fetchPage(pageId) {
    return this.api(`/wiki/rest/api/content/${pageId}`, {
      expand: 'body.storage,history.lastUpdated,history.createdBy,version,space',
    });
  }

  async searchRecentPageIds(space) {
    const includeRecentPages = Math.max(0, Number(space?.include_recent_pages ?? 0));
    if (!space?.key || includeRecentPages === 0) return [];
    const lookbackHours = Math.max(1, Number(this.collectorConfig.initial_lookback_hours ?? 168));
    const sinceDate = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString().slice(0, 10);
    const payload = await this.api('/wiki/rest/api/content/search', {
      cql: `space = "${space.key}" AND type = page AND lastmodified >= "${sinceDate}" ORDER BY lastmodified DESC`,
      limit: includeRecentPages,
      expand: 'history.lastUpdated,version,space',
    });
    return (payload.results ?? []).map((entry) => String(entry.id)).filter(Boolean);
  }

  writeRawJson(pageId, value) {
    const path = resolve(this.rawEventDir, 'pages', `${pageId}.json`);
    writeJson(path, value);
    return path;
  }

  writePageText(pageId, text) {
    ensureDir(this.fileCacheDir);
    return writeTextFile(resolve(this.fileCacheDir, `${pageId}.txt`), text);
  }

  async collectTargetPageIds() {
    const explicit = (this.collectorConfig.pages ?? [])
      .map(pageConfigId)
      .filter(Boolean);
    const recentIds = [];
    for (const space of this.collectorConfig.spaces ?? []) {
      recentIds.push(...(await this.searchRecentPageIds(space)));
    }
    return [...new Set([...explicit, ...recentIds])];
  }

  async trackPage({ page, state, events }) {
    const pageId = String(page.id ?? '');
    if (!pageId) return;

    const pageText = htmlToText(page?.body?.storage?.value ?? '');
    const updatedAt = pageUpdatedAt(page);
    const version = Number(page?.version?.number ?? page?.history?.lastUpdated?.number ?? 0);
    const fingerprint = stableHash({
      title: page.title,
      text: pageText,
      updated_at: updatedAt,
      version,
    });
    if (state.pages?.[pageId]?.fingerprint === fingerprint) return;

    const rawPath = this.writeRawJson(pageId, page);
    const textPath = pageText ? this.writePageText(pageId, pageText) : rawPath;
    const actor = pageActor(page) || 'unknown';
    const workspaceOwner = mapActorToMember(this.config, actor) ?? 'jared';
    events.push({
      source: 'confluence',
      object_type: 'confluence-page',
      object_id: pageId,
      object_title: page.title || `Confluence page ${pageId}`,
      object_url: pageUrl(this.baseUrl, page),
      actor,
      workspace_owner: workspaceOwner,
      changed_at: updatedAt,
      native_change_id: `${pageId}-v${version || updatedAt}`,
      summary: `Confluence page updated: ${page.title || pageId}${pageText ? ` | Content: ${excerpt(pageText, 180)}` : ''}`,
      raw_ref: textPath,
    });
    state.pages[pageId] = {
      fingerprint,
      updated_at: updatedAt,
      version,
      last_polled_at: new Date().toISOString(),
    };
  }

  async pollOnce() {
    if (this.collectorConfig.enabled === false) {
      return { enabled: false, event_count: 0, candidate_count: 0, log_results: [] };
    }
    if (!this.email || !this.token || !this.baseUrl) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'missing_credentials' };
    }

    const pageIds = await this.collectTargetPageIds();
    if (pageIds.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'no_pages' };
    }

    const state = this.readState();
    state.pages ??= {};
    const events = [];
    const limit = Math.max(1, Number(this.collectorConfig.max_pages_per_poll ?? 25));

    for (const pageId of pageIds.slice(0, limit)) {
      const page = await this.fetchPage(pageId);
      await this.trackPage({ page, state, events });
    }

    this.writeState(state);
    if (events.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [] };
    }
    return this.ingestEvents({ repoRoot: this.repoRoot, events });
  }
}

export function startConfluenceCollector({ collector, intervalSeconds, logger = console }) {
  const seconds = Math.max(60, Number(intervalSeconds ?? 600));
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await collector.pollOnce();
      logger.log?.(`[confluence-collector] poll complete: ${result.event_count} event(s), ${result.candidate_count} candidate(s)${result.reason ? ` (${result.reason})` : ''}`);
      if (result.candidates?.length) {
        for (const c of result.candidates) {
          logger.log?.(`[confluence-collector]   candidate: type=${c.candidate_type} key=${c.candidate_key} signal=${c.signal_score ?? '-'} artifact=${c.artifact_type ?? '-'}`);
        }
      }
    } catch (error) {
      logger.error?.(`[confluence-collector] poll failed: ${error.message}`);
    } finally {
      inFlight = false;
    }
  };

  setInterval(() => {
    void tick();
  }, seconds * 1000);

  return tick();
}
