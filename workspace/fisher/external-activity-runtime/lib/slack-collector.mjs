import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ingestActivityEvents } from '../../../../scripts/lib/activity-runner.mjs';
import { inferMemberKeyFromSlackUser } from './member-resolver.mjs';

const execFileAsync = promisify(execFile);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultImageOcrScriptPath = resolve(moduleDir, '..', 'scripts', 'ocr-image.swift');

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function excerpt(text, limit = 140) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function slackTsToDate(slackTs) {
  const seconds = Number(String(slackTs ?? '').split('.')[0]);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : new Date();
}

function slackTsToIso(slackTs) {
  return slackTsToDate(slackTs).toISOString();
}

function slackTsToken(slackTs) {
  return String(slackTs ?? '').replace('.', '_');
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function decodeHtmlEntities(text) {
  return String(text)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function extractTextFromSlackFile({ name, mimetype, filetype, content }) {
  const normalizedName = String(name ?? '').toLowerCase();
  const normalizedMimetype = String(mimetype ?? '').toLowerCase();
  const normalizedType = String(filetype ?? '').toLowerCase();
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content ?? '');

  if (normalizedMimetype.includes('html') || normalizedType === 'html' || normalizedName.endsWith('.html')) {
    return decodeHtmlEntities(
      text
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
    ).replace(/\s+/g, ' ').trim();
  }

  if (
    normalizedMimetype.startsWith('text/')
    || ['csv', 'json', 'md', 'markdown', 'js', 'ts', 'html', 'xml'].includes(normalizedType)
    || /\.(txt|md|markdown|csv|json|js|ts|html|xml)$/i.test(normalizedName)
  ) {
    return text.trim();
  }

  return null;
}

function isImageFile(file) {
  const mimetype = String(file?.mimetype ?? '').toLowerCase();
  const filetype = String(file?.filetype ?? '').toLowerCase();
  const name = String(file?.name ?? '').toLowerCase();
  return mimetype.startsWith('image/')
    || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tiff', 'tif', 'bmp'].includes(filetype)
    || /\.(png|jpe?g|gif|webp|heic|tiff?|bmp)$/i.test(name);
}

export async function ocrImageWithMacVision(filePath, { collectorConfig = {} } = {}) {
  const scriptPath = resolve(collectorConfig.image_ocr_script_path ?? defaultImageOcrScriptPath);
  const timeout = Math.max(1000, Number(collectorConfig.image_ocr_timeout_ms ?? 30000));
  const maxBuffer = Math.max(1024, Number(collectorConfig.image_ocr_max_buffer_bytes ?? 1024 * 1024));
  const { stdout } = await execFileAsync('swift', [scriptPath, filePath], { timeout, maxBuffer });
  const maxChars = Math.max(0, Number(collectorConfig.image_ocr_max_chars ?? 12000));
  const text = String(stdout ?? '').replace(/\r\n/g, '\n').trim();
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[OCR truncated at ${maxChars} chars]`;
}

function buildMessageUrl(workspaceUrl, channelId, ts) {
  const base = String(workspaceUrl ?? '').replace(/\/$/, '');
  if (!base) return `https://slack.com/archives/${channelId}/p${String(ts).replace('.', '')}`;
  return `${base}/archives/${channelId}/p${String(ts).replace('.', '')}`;
}

function channelKey(channelId, ts) {
  return `message__${channelId}__${slackTsToken(ts)}`;
}

function threadKey(channelId, threadTs) {
  return `thread__${channelId}__${slackTsToken(threadTs)}`;
}

function fileKey(fileId) {
  return `file__${fileId}`;
}

function objectTitleForChannelMessage(channelName, text, fallbackTs) {
  const body = excerpt(text || fallbackTs || 'Slack message');
  return `#${channelName} ${body}`;
}

function shouldIgnoreFile(collectorConfig, file) {
  // Fisher asked for Slack images to always go through OCR ingestion. Keep the
  // legacy ignore knobs for other file classes, but do not let image/* or image
  // extensions suppress OCR-capable Slack files unless OCR is explicitly off.
  if (collectorConfig.image_ocr_enabled !== false && isImageFile(file)) return false;

  const mimetype = String(file?.mimetype ?? '').toLowerCase();
  const name = String(file?.name ?? '').toLowerCase();
  const ignoredPrefixes = collectorConfig.ignored_file_mimetype_prefixes ?? [];
  const ignoredExtensions = collectorConfig.ignored_file_extensions ?? [];
  if (ignoredPrefixes.some((prefix) => mimetype.startsWith(String(prefix).toLowerCase()))) return true;
  if (ignoredExtensions.some((extension) => name.endsWith(String(extension).toLowerCase()))) return true;
  return false;
}

export class SlackCollector {
  constructor({
    repoRoot,
    config,
    token = process.env.SLACK_BOT_TOKEN,
    fetchImpl = fetch,
    ingestEvents = ingestActivityEvents,
    ocrImage = ocrImageWithMacVision,
  }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.ingestEvents = ingestEvents;
    this.ocrImage = ocrImage;
    this.collectorConfig = config.collector ?? {};
    this.workspaceUrl = process.env.SLACK_WORKSPACE_URL || config.bot?.workspace_url || '';
    this.statePath = resolve(repoRoot, this.collectorConfig.state_path ?? '.runtime/slack-collector/state.json');
    this.fileCacheDir = resolve(repoRoot, this.collectorConfig.file_cache_dir ?? '.runtime/slack-collector/files');
    this.rawEventDir = resolve(repoRoot, this.collectorConfig.raw_event_dir ?? '.runtime/slack-collector/raw');
    this.userCache = new Map();
    this.userInfoCache = new Map();
  }

  readState() {
    return readJson(this.statePath, { channels: {}, threads: {}, files: {} });
  }

  writeState(state) {
    writeJson(this.statePath, state);
  }

  async api(method, params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      search.set(key, String(value));
    }
    const url = `https://slack.com/api/${method}?${search.toString()}`;
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Slack API ${method} failed with ${response.status}`);
    }
    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(`Slack API ${method} error: ${payload.error ?? 'unknown'}`);
    }
    return payload;
  }

  async fetchBinary(url) {
    const response = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Slack file download failed with ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async userInfo(slackUserId) {
    if (!slackUserId) return null;
    if (this.userInfoCache.has(slackUserId)) return this.userInfoCache.get(slackUserId);
    try {
      const payload = await this.api('users.info', { user: slackUserId });
      const user = payload.user ?? null;
      this.userInfoCache.set(slackUserId, user);
      return user;
    } catch {
      this.userInfoCache.set(slackUserId, null);
      return null;
    }
  }

  async userName(slackUserId) {
    if (!slackUserId) return 'unknown';
    if (this.userCache.has(slackUserId)) return this.userCache.get(slackUserId);
    const user = await this.userInfo(slackUserId);
    if (!user) {
      this.userCache.set(slackUserId, slackUserId);
      return slackUserId;
    }
    const profile = user.profile ?? {};
    const name = profile.display_name || profile.real_name || user.name || slackUserId;
    this.userCache.set(slackUserId, name);
    return name;
  }

  async resolveMemberKey(slackUserId) {
    if (!slackUserId) return null;
    const user = await this.userInfo(slackUserId);
    return inferMemberKeyFromSlackUser({
      config: this.config,
      repoRoot: this.repoRoot,
      slackUserId,
      user,
    });
  }

  async fetchChannelMessages(channel, oldest) {
    const messages = [];
    let cursor = null;
    let pages = 0;
    const maxPages = Math.max(1, Number(this.collectorConfig.max_pages_per_channel ?? 3));
    do {
      const payload = await this.api('conversations.history', {
        channel: channel.id,
        oldest,
        inclusive: false,
        limit: 200,
        cursor,
      });
      messages.push(...(payload.messages ?? []));
      cursor = payload.response_metadata?.next_cursor || null;
      pages += 1;
    } while (cursor && pages < maxPages);
    return messages;
  }

  async fetchThreadMessages(channelId, threadTs) {
    const payload = await this.api('conversations.replies', {
      channel: channelId,
      ts: threadTs,
      limit: 200,
    });
    return payload.messages ?? [];
  }

  async fetchFileInfo(fileId) {
    try {
      const payload = await this.api('files.info', { file: fileId });
      return payload.file ?? null;
    } catch (error) {
      if (String(error?.message ?? '').includes('Slack API files.info error: file_not_found')) {
        return null;
      }
      throw error;
    }
  }

  writeRawJson(kind, key, value) {
    const path = resolve(this.rawEventDir, kind, `${key}.json`);
    writeJson(path, value);
    return path;
  }

  async trackMessage({ channel, message, state, events, trackedFileIds, trackedThreads, fileCaptureOnly }) {
    if (this.collectorConfig.ignore_bot_messages && (message.bot_id || message.subtype === 'bot_message')) {
      return;
    }

    const text = normalizeText(message.text);
    const fingerprint = stableHash({
      text,
      edited: message.edited?.ts ?? null,
      files: (message.files ?? []).map((file) => file.id).sort(),
      reply_count: message.reply_count ?? 0,
      latest_reply: message.latest_reply ?? null,
      subtype: message.subtype ?? null,
    });
    const channelState = state.channels[channel.id] ?? { cursor_ts: null, messages: {} };
    const priorState = channelState.messages[message.ts] ?? {};
    const priorFingerprint = priorState.fingerprint;
    channelState.messages[message.ts] = {
      fingerprint,
      latest_reply: message.latest_reply ?? priorState.latest_reply ?? null,
      last_seen_at: new Date().toISOString(),
    };

    if (message.thread_ts === message.ts && Number(message.reply_count ?? 0) > 0 && channel.include_threads !== false) {
      trackedThreads.set(threadKey(channel.id, message.thread_ts), {
        channel,
        thread_ts: message.thread_ts,
        root_text: text,
        latest_reply: message.latest_reply ?? message.thread_ts,
        discovered_now: true,
      });
    }

    for (const file of message.files ?? []) {
      if (file?.id && !shouldIgnoreFile(this.collectorConfig, file) && channel.include_files !== false) {
        trackedFileIds.add(file.id);
        fileCaptureOnly.set(file.id, (fileCaptureOnly.get(file.id) ?? true) && channel.capture_only === true);
      }
    }

    if (priorFingerprint === fingerprint) {
      state.channels[channel.id] = channelState;
      return;
    }

    const slackUserId = message.user || message.bot_id || '';
    const workspaceOwner = await this.resolveMemberKey(message.user) ?? 'jared';
    const actorName = await this.userName(message.user);
    const objectId = channelKey(channel.id, message.ts);
    const rawPath = this.writeRawJson('messages', objectId, { channel, message });
    if (channel.capture_only === true) {
      state.channels[channel.id] = channelState;
      return;
    }
    events.push({
      source: 'slack',
      object_type: 'slack-message',
      object_id: objectId,
      object_title: objectTitleForChannelMessage(channel.name, text, message.ts),
      object_url: buildMessageUrl(this.workspaceUrl, channel.id, message.ts),
      actor: actorName || slackUserId || workspaceOwner,
      workspace_owner: workspaceOwner,
      changed_at: slackTsToIso(message.edited?.ts ?? message.ts),
      native_change_id: `${objectId}-${message.edited?.ts ?? message.ts}-${fingerprint}`,
      summary: `Slack message in #${channel.name}: ${excerpt(text || '[no text]')}`,
      raw_ref: rawPath,
    });

    state.channels[channel.id] = channelState;
  }

  async trackThread({ channel, threadTs, rootText, state, events, trackedFileIds, fileCaptureOnly }) {
    const messages = await this.fetchThreadMessages(channel.id, threadTs);
    for (const message of messages) {
      if (this.collectorConfig.ignore_bot_messages && (message.bot_id || message.subtype === 'bot_message')) {
        continue;
      }
      for (const file of message.files ?? []) {
        if (file?.id && !shouldIgnoreFile(this.collectorConfig, file) && channel.include_files !== false) {
          trackedFileIds.add(file.id);
          fileCaptureOnly.set(file.id, (fileCaptureOnly.get(file.id) ?? true) && channel.capture_only === true);
        }
      }
    }

    const fingerprint = stableHash(messages.map((message) => ({
      ts: message.ts,
      text: normalizeText(message.text),
      edited: message.edited?.ts ?? null,
      files: (message.files ?? []).map((file) => file.id).sort(),
    })));
    const key = threadKey(channel.id, threadTs);
    const priorFingerprint = state.threads[key]?.fingerprint;
    state.threads[key] = {
      fingerprint,
      latest_reply: messages.at(-1)?.ts ?? threadTs,
      last_polled_at: new Date().toISOString(),
    };
    if (priorFingerprint === fingerprint) return;

    const latestMessage = [...messages].sort((left, right) => Number(left.ts) - Number(right.ts)).at(-1) ?? { ts: threadTs };
    const workspaceOwner = await this.resolveMemberKey(latestMessage.user)
      ?? await this.resolveMemberKey(messages[0]?.user)
      ?? 'jared';
    const actorName = await this.userName(latestMessage.user || messages[0]?.user);
    const rawPath = this.writeRawJson('threads', key, { channel, messages });
    if (channel.capture_only === true) return;
    events.push({
      source: 'slack',
      object_type: 'slack-thread',
      object_id: key,
      object_title: objectTitleForChannelMessage(channel.name, rootText, threadTs),
      object_url: buildMessageUrl(this.workspaceUrl, channel.id, threadTs),
      actor: actorName || workspaceOwner,
      workspace_owner: workspaceOwner,
      changed_at: slackTsToIso(latestMessage.edited?.ts ?? latestMessage.ts ?? threadTs),
      native_change_id: `${key}-${fingerprint}`,
      summary: `Slack thread updated in #${channel.name}: ${excerpt(normalizeText(latestMessage.text) || rootText || '[no text]')}`,
      raw_ref: rawPath,
    });
  }

  async trackFile({ fileId, state, events, captureOnly = false }) {
    const file = await this.fetchFileInfo(fileId);
    if (!file) return;
    if (shouldIgnoreFile(this.collectorConfig, file)) return;

    const metadataFingerprint = stableHash({
      id: file.id,
      title: file.title,
      name: file.name,
      size: file.size,
      mimetype: file.mimetype,
      filetype: file.filetype,
      created: file.created,
      updated: file.updated ?? null,
      timestamp: file.timestamp ?? null,
    });

    let rawPath = this.writeRawJson('files', fileKey(file.id), { file });
    let extractedText = null;
    let contentHash = null;
    const downloadUrl = file.url_private_download || file.url_private;
    const maxBytes = Number(this.collectorConfig.file_download_max_bytes ?? 5 * 1024 * 1024);

    if (downloadUrl && Number(file.size ?? 0) > 0 && Number(file.size ?? 0) <= maxBytes) {
      try {
        const content = await this.fetchBinary(downloadUrl);
        const fileDir = resolve(this.fileCacheDir, file.id);
        ensureDir(fileDir);
        const filePath = resolve(fileDir, file.name || `${file.id}.bin`);
        writeFileSync(filePath, content);
        extractedText = extractTextFromSlackFile({
          name: file.name,
          mimetype: file.mimetype,
          filetype: file.filetype,
          content,
        });
        if (!extractedText && this.collectorConfig.image_ocr_enabled !== false && isImageFile(file)) {
          let ocrText = null;
          try {
            ocrText = await this.ocrImage(filePath, {
              file,
              collectorConfig: this.collectorConfig,
            });
          } catch {
            // Keep the downloaded image and metadata event even if OCR is unavailable.
          }
          if (ocrText) extractedText = `OCR text from image ${file.title || file.name || file.id}:\n${ocrText}`;
        }
        if (extractedText) {
          const textPath = resolve(fileDir, `${file.id}.txt`);
          writeFileSync(textPath, `${extractedText}\n`, 'utf8');
          rawPath = textPath;
        } else {
          rawPath = filePath;
        }
        contentHash = stableHash({ content: content.toString('base64'), extractedText });
      } catch {
        // Metadata-only fallback is acceptable for files we cannot download or parse.
      }
    }

    const fingerprint = stableHash({ metadataFingerprint, contentHash });
    const key = fileKey(file.id);
    const priorFingerprint = state.files[key]?.fingerprint;
    const wasCaptureOnly = state.files[key]?.capture_only === true;
    state.files[key] = {
      fingerprint,
      last_polled_at: new Date().toISOString(),
      capture_only: captureOnly,
    };
    if (priorFingerprint === fingerprint && (captureOnly || !wasCaptureOnly)) return;
    if (captureOnly) return;

    const workspaceOwner = await this.resolveMemberKey(file.user) ?? 'jared';
    const actorName = await this.userName(file.user);
    const changedAt = slackTsToIso(file.updated ?? file.timestamp ?? file.created);
    const textHint = extractedText ? ` | Content: ${excerpt(extractedText, 180)}` : '';
    events.push({
      source: 'slack',
      object_type: 'slack-file',
      object_id: key,
      object_title: file.title || file.name || key,
      object_url: file.permalink || file.url_private || buildMessageUrl(this.workspaceUrl, 'files', file.id),
      actor: actorName || workspaceOwner,
      workspace_owner: workspaceOwner,
      changed_at: changedAt,
      native_change_id: `${key}-${fingerprint}`,
      summary: `Slack file updated: ${file.title || file.name || key}${textHint}`,
      raw_ref: rawPath,
    });
  }

  async pollOnce() {
    if (this.collectorConfig.enabled === false) {
      return { enabled: false, event_count: 0, candidate_count: 0, log_results: [] };
    }

    const channels = Array.isArray(this.collectorConfig.channels) ? this.collectorConfig.channels : [];
    if (channels.length === 0) {
      return { enabled: true, event_count: 0, candidate_count: 0, log_results: [], reason: 'no_channels' };
    }

    const state = this.readState();
    state.channels ??= {};
    state.threads ??= {};
    state.files ??= {};
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nowMs = Date.now();
    const overlapSeconds = Number(this.collectorConfig.history_overlap_seconds ?? 900);
    const initialLookbackHours = Number(this.collectorConfig.initial_lookback_hours ?? 168);
    const threadRefreshMs = Number(this.collectorConfig.thread_refresh_seconds ?? 21600) * 1000;
    const fileRefreshMs = Number(this.collectorConfig.file_refresh_seconds ?? 21600) * 1000;
    const events = [];
    const trackedFileIds = new Set();
    const fileCaptureOnly = new Map();
    const trackedThreads = new Map();
    const channelErrors = [];
    const threadErrors = [];
    const fileErrors = [];

    for (const channel of channels) {
      state.channels[channel.id] ??= { cursor_ts: null, messages: {} };
      const cursorTs = Number(state.channels[channel.id].cursor_ts ?? 0);
      const oldest = Math.max(cursorTs - overlapSeconds, nowSeconds - initialLookbackHours * 3600);
      let messages;
      try {
        messages = await this.fetchChannelMessages(channel, oldest);
      } catch (error) {
        channelErrors.push({
          channel_id: channel.id,
          channel_name: channel.name,
          error: error.message,
        });
        continue;
      }

      let latestSeen = cursorTs;
      for (const message of messages) {
        if (!message?.ts) continue;
        latestSeen = Math.max(latestSeen, Number(message.ts));
        await this.trackMessage({ channel, message, state, events, trackedFileIds, trackedThreads, fileCaptureOnly });
      }
      state.channels[channel.id].cursor_ts = latestSeen || cursorTs;

      for (const [key, thread] of Object.entries(state.threads ?? {})) {
        if (key.startsWith(`thread__${channel.id}__`)) {
          const shouldRefresh = !thread.last_polled_at || (nowMs - Date.parse(thread.last_polled_at)) >= threadRefreshMs;
          if (shouldRefresh) {
            trackedThreads.set(key, {
              channel,
              thread_ts: key.split('__').slice(2).join('__').replace('_', '.'),
              root_text: '',
              latest_reply: thread.latest_reply ?? null,
              discovered_now: false,
            });
          }
        }
      }
    }

    const limitedThreads = [...trackedThreads.entries()]
      .sort(([, left], [, right]) => String(right.latest_reply ?? '').localeCompare(String(left.latest_reply ?? '')))
      .slice(0, Math.max(1, Number(this.collectorConfig.max_threads_per_poll ?? 40)));

    for (const [key, thread] of limitedThreads) {
      const threadTs = key.split('__').slice(2).join('__').replace('_', '.');
      try {
        await this.trackThread({
          channel: thread.channel,
          threadTs,
          rootText: thread.root_text,
          state,
          events,
          trackedFileIds,
          fileCaptureOnly,
        });
      } catch (error) {
        threadErrors.push({
          channel_id: thread.channel.id,
          channel_name: thread.channel.name,
          thread_ts: threadTs,
          error: error.message,
        });
      }
    }

    for (const [existingKey, fileState] of Object.entries(state.files ?? {})) {
      if (!existingKey.startsWith('file__')) continue;
      const shouldRefresh = !fileState.last_polled_at || (nowMs - Date.parse(fileState.last_polled_at)) >= fileRefreshMs;
      if (shouldRefresh) {
        const id = existingKey.replace(/^file__/, '');
        trackedFileIds.add(id);
        fileCaptureOnly.set(id, (fileCaptureOnly.get(id) ?? true) && fileState.capture_only === true);
      }
    }

    for (const fileId of [...trackedFileIds].slice(0, Math.max(1, Number(this.collectorConfig.max_files_per_poll ?? 40)))) {
      try {
        await this.trackFile({ fileId, state, events, captureOnly: fileCaptureOnly.get(fileId) === true });
      } catch (error) {
        fileErrors.push({
          file_id: fileId,
          error: error.message,
        });
      }
    }

    this.writeState(state);
    if (events.length === 0) {
      return {
        enabled: true,
        event_count: 0,
        candidate_count: 0,
        log_results: [],
        channel_errors: channelErrors,
        thread_errors: threadErrors,
        file_errors: fileErrors,
      };
    }
    const result = await this.ingestEvents({ repoRoot: this.repoRoot, events });
    return { ...result, channel_errors: channelErrors, thread_errors: threadErrors, file_errors: fileErrors };
  }
}

export function startSlackCollector({ collector, intervalSeconds, logger = console }) {
  const seconds = Math.max(30, Number(intervalSeconds ?? 300));
  let inFlight = false;

  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await collector.pollOnce();
      logger.log?.(`[slack-collector] poll complete: ${result.event_count} event(s), ${result.candidate_count} candidate(s)${result.log_results?.length ? ` | logs: ${result.log_results.length}` : ''}`);
      if (result.candidates?.length) {
        for (const c of result.candidates) {
          logger.log?.(`[slack-collector]   candidate: type=${c.candidate_type} key=${c.candidate_key} signal=${c.signal_score ?? '-'} artifact=${c.artifact_type ?? '-'}`);
        }
      }
    } catch (error) {
      logger.error?.(`[slack-collector] poll failed: ${error.message}`);
    } finally {
      inFlight = false;
    }
  };

  setInterval(() => {
    void tick();
  }, seconds * 1000);

  return tick();
}
