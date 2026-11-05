import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';

export function repoRootFrom(importMetaDirname) {
  return resolve(importMetaDirname, '..', '..', '..');
}

export function loadEnvFile(path, allowedKeys = null) {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (allowedKeys && !allowedKeys.includes(key)) continue;
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadHermesSlackToken() {
  const hermesHome = process.env.HERMES_HOME || resolve(homedir(), '.hermes');
  loadEnvFile(resolve(hermesHome, '.env'), ['SLACK_BOT_TOKEN']);
}

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const next = { ...base };
    for (const [key, value] of Object.entries(override)) {
      next[key] = mergeDeep(base[key], value);
    }
    return next;
  }

  return override ?? base;
}

const DEFAULT_CONFIG = {
  bot: {
    approval_poll_seconds: 60,
    delivery_state_path: '.runtime/external-activity-runtime/state.json',
    workspace_url: process.env.SLACK_WORKSPACE_URL || 'https://your-workspace.slack.com',
    dm_help_text: [
      '*External Activity Moderation Adapter*',
      '',
      'Primary UX:',
      '- Use the Slack buttons on activity digests and update notices',
      '',
      'Fallback commands:',
      '- `approvals` or `list`',
      '- `reject <candidate_id>`',
      '- `revoke <signature>`',
      '- `delete-observation <signature>`',
      '- `inbox`',
      '- `ack <n|inbox_id>`',
      '- `discard <n|inbox_id>`',
      '- `help`',
      '',
      'Free-form repo questions now belong to the Hermes Slack gateway for Fisher.',
    ].join('\n'),
  },
  collector: {
    enabled: true,
    poll_seconds: 300,
    state_path: '.runtime/slack-collector/state.json',
    file_cache_dir: '.runtime/slack-collector/files',
    raw_event_dir: '.runtime/slack-collector/raw',
    history_overlap_seconds: 900,
    initial_lookback_hours: 168,
    max_pages_per_channel: 3,
    max_threads_per_poll: 40,
    max_files_per_poll: 40,
    thread_refresh_seconds: 21600,
    file_refresh_seconds: 21600,
    file_download_max_bytes: 5 * 1024 * 1024,
    image_ocr_enabled: true,
    image_ocr_timeout_ms: 30000,
    image_ocr_max_chars: 12000,
    ignore_bot_messages: true,
    ignored_file_mimetype_prefixes: ['image/'],
    ignored_file_extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic'],
    channels: [],
  },
  confluence: {
    enabled: true,
    poll_seconds: 600,
    state_path: '.runtime/confluence-collector/state.json',
    raw_event_dir: '.runtime/confluence-collector/raw',
    file_cache_dir: '.runtime/confluence-collector/files',
    initial_lookback_hours: 168,
    max_pages_per_poll: 25,
    pages: [],
    spaces: [],
  },
  drive: {
    enabled: true,
    mode: 'google_api',
    poll_seconds: 600,
    state_path: '.runtime/drive-collector/state.json',
    raw_event_dir: '.runtime/drive-collector/raw',
    file_cache_dir: '.runtime/drive-collector/files',
    file_download_max_bytes: 5 * 1024 * 1024,
    max_files_per_poll: 25,
    max_changes_per_poll: 25,
    max_sheets_per_file: 10,
    change_source: 'changes_list',
    workspace_events: {
      enabled: false,
      subscription: '',
      topic: '',
    },
    shared_drives: [],
    folders: [],
    files: [],
  },
  meeting: {
    enabled: false,
    poll_seconds: 600,
  },
  chat: {
    enabled: false,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    max_tool_calls: 6,
    max_context_results: 6,
    confirmation_required: true,
    preapprove_member_dms: true,
    session_ttl_minutes: 120,
  },
  members: {},
  reflection: {
    enabled: true,
    promotion_confidence_threshold: 0.8,
    observation_confidence_threshold: 0.5,
  },
  digest: {
    enabled: true,
    schedule: ['12:00', '18:00'],
    timezone: 'Asia/Seoul',
    channel: null,
    include_observations: true,
    max_items_per_section: 10,
  },
  inbox: {
    notify_poll_seconds: 120,
    session_ttl_minutes: 60,
  },
};

export function externalActivityRuntimeConfigPath(repoRoot) {
  return resolve(repoRoot, 'workspace', 'fisher', 'config', 'external-activity.yml');
}

export function loadExternalActivityRuntimeConfig(repoRoot) {
  const path = externalActivityRuntimeConfigPath(repoRoot);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const parsed = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return mergeDeep(DEFAULT_CONFIG, parsed);
}

export const slackActivityConfigPath = externalActivityRuntimeConfigPath;
export const loadSlackActivityConfig = loadExternalActivityRuntimeConfig;
