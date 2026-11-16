import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { externalActivityConfigPath, loadExternalActivityConfig } from './activity-config.mjs';
import { parseEnvFile, upsertEnvVariables } from './desk-setup.mjs';
import { listMemberEntries } from './members.mjs';
import { loadMeetingIngestionConfig, meetingIngestionConfigPath } from './meeting-sync/config.mjs';
import {
  externalActivityRuntimeConfigPath,
  loadExternalActivityRuntimeConfig,
} from '../../workspace/fisher/external-activity-runtime/lib/config.mjs';
import {
  GoogleServiceAccountAuth,
  loadGoogleServiceAccount,
} from '../../workspace/fisher/external-activity-runtime/lib/google-auth.mjs';

export const CONNECTOR_SOURCES = ['github', 'slack', 'drive', 'notion', 'gmail', 'confluence'];

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function loadMergedEnv(repoRoot) {
  const fisherEnv = parseEnvFile(
    resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env'),
  );
  const rootEnv = parseEnvFile(resolve(repoRoot, '.env'));
  return {
    ...fisherEnv,
    ...rootEnv,
    ...process.env,
  };
}

function parseCsvList(value) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
  return [...new Set(String(value).split(',').map((v) => v.trim()).filter(Boolean))];
}

function assertConnectorSource(source) {
  const s = String(source ?? '').trim().toLowerCase();
  if (!CONNECTOR_SOURCES.includes(s)) {
    throw new Error(`Unknown connector '${source}'. Valid sources: ${CONNECTOR_SOURCES.join(', ')}`);
  }
  return s;
}

export function extractDriveFolderId(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const folderMatch = raw.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch) return idParamMatch[1];
  return raw;
}

function watermarksPath(repoRoot) {
  const config = loadExternalActivityConfig(repoRoot);
  return resolve(repoRoot, config.runtime?.state_dir ?? '.hey/external-activity', 'connector-watermarks.json');
}

export function loadConnectorWatermarks(repoRoot) {
  const path = watermarksPath(repoRoot);
  if (!existsSync(path)) return { sources: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return {
      sources: parsed && typeof parsed.sources === 'object' && parsed.sources ? parsed.sources : {},
    };
  } catch {
    return { sources: {} };
  }
}

export function recordConnectorWatermark(repoRoot, source, meta = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const normalizedSource = String(source ?? '').trim().toLowerCase();
  if (!normalizedSource) throw new Error('recordConnectorWatermark requires source');
  const path = watermarksPath(root);
  const current = loadConnectorWatermarks(root);
  const timestamp = meta.last_polled_at || new Date().toISOString();
  current.sources[normalizedSource] = {
    ...(current.sources[normalizedSource] ?? {}),
    ...meta,
    source: normalizedSource,
    last_polled_at: timestamp,
    updated_at: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current.sources[normalizedSource];
}

function readRawYaml(filePath) {
  if (!existsSync(filePath)) return {};
  return parseYaml(readFileSync(filePath, 'utf8')) ?? {};
}

function writeYamlFile(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, stringifyYaml(data), 'utf8');
}

function evaluateCredentials(source, env) {
  const hasGoogleSa = Boolean(
    env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 ||
    (env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH && existsSync(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH)) ||
    (env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
  );

  switch (source) {
    case 'github': {
      let ghAuthed = false;
      try {
        execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', timeout: 3000 });
        ghAuthed = true;
      } catch {
        ghAuthed = false;
      }
      const hasToken = Boolean(env.GITHUB_TOKEN);
      return {
        ready: hasToken || ghAuthed,
        required_env_keys: ['GITHUB_TOKEN (or `gh auth login`)'],
        present_env_keys: [hasToken && 'GITHUB_TOKEN', ghAuthed && 'gh_cli_session'].filter(Boolean),
        missing_env_keys: hasToken || ghAuthed ? [] : ['GITHUB_TOKEN or `gh auth login`'],
      };
    }
    case 'slack': {
      const req = ['SLACK_BOT_TOKEN'];
      const present = req.filter((k) => Boolean(env[k]));
      return {
        ready: present.length === req.length,
        required_env_keys: req,
        present_env_keys: present,
        missing_env_keys: req.filter((k) => !env[k]),
      };
    }
    case 'drive': {
      const candidates = [
        'GOOGLE_SERVICE_ACCOUNT_JSON_PATH',
        'GOOGLE_SERVICE_ACCOUNT_JSON',
        'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      ];
      return {
        ready: hasGoogleSa,
        required_env_keys: ['GOOGLE_SERVICE_ACCOUNT_JSON_PATH (or JSON/BASE64)'],
        present_env_keys: candidates.filter((k) => Boolean(env[k])),
        missing_env_keys: hasGoogleSa ? [] : ['GOOGLE_SERVICE_ACCOUNT_JSON_PATH'],
      };
    }
    case 'notion': {
      const req = ['NOTION_TOKEN'];
      const present = req.filter((k) => Boolean(env[k]));
      return {
        ready: present.length === req.length,
        required_env_keys: req,
        present_env_keys: present,
        missing_env_keys: req.filter((k) => !env[k]),
      };
    }
    case 'gmail': {
      const req = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
      const present = req.filter((k) => Boolean(env[k]));
      return {
        ready: present.length === req.length,
        required_env_keys: req,
        present_env_keys: present,
        missing_env_keys: req.filter((k) => !env[k]),
      };
    }
    case 'confluence': {
      const req = ['ATLASSIAN_EMAIL', 'ATLASSIAN_API_TOKEN', 'ATLASSIAN_BASE_URL'];
      const present = req.filter((k) => Boolean(env[k]));
      return {
        ready: present.length === req.length,
        required_env_keys: req,
        present_env_keys: present,
        missing_env_keys: req.filter((k) => !env[k]),
      };
    }
    default:
      return { ready: false, required_env_keys: [], present_env_keys: [], missing_env_keys: [] };
  }
}

function resolveConnectorList(repoRoot, { maxAgeMinutes = 120, now = Date.now() } = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const policyRaw = readRawYaml(externalActivityConfigPath(root));
  const fisherRaw = readRawYaml(externalActivityRuntimeConfigPath(root));
  const fisherCfg = loadExternalActivityRuntimeConfig(root);
  const meetingCfg = loadMeetingIngestionConfig(root);
  const env = loadMergedEnv(root);
  const watermarks = loadConnectorWatermarks(root).sources;

  return CONNECTOR_SOURCES.map((source) => {
    const policySource = policyRaw?.sources?.[source] ?? {};
    const creds = evaluateCredentials(source, env);
    let enabled = Boolean(policySource.enabled);
    let targets = [];

    if (source === 'github') {
      enabled = enabled || Boolean(fisherRaw?.github?.enabled);
      targets = policySource.repos?.length ? policySource.repos : (fisherCfg?.github?.repos ?? []);
    } else if (source === 'slack') {
      targets = policySource.channels?.length
        ? policySource.channels
        : (fisherCfg?.collector?.channels ?? []).map((c) => (typeof c === 'string' ? c : c.id)).filter(Boolean);
    } else if (source === 'drive') {
      enabled = enabled || Boolean(fisherRaw?.drive?.enabled);
      targets = [
        ...(fisherCfg?.drive?.folders ?? []),
        ...(policySource.shared_drives ?? fisherCfg?.drive?.shared_drives ?? []),
      ];
    } else if (source === 'confluence') {
      enabled = enabled || Boolean(fisherRaw?.confluence?.enabled);
      const rawSpaces = policySource.spaces?.length ? policySource.spaces : (fisherCfg?.confluence?.spaces ?? []);
      targets = rawSpaces.map((s) => (typeof s === 'string' ? s : s.key)).filter(Boolean);
    } else if (source === 'notion') {
      const notionCfg = meetingCfg?.notion ?? {};
      const notionRaw = readRawYaml(meetingIngestionConfigPath(root))?.notion ?? {};
      enabled = enabled || Boolean(notionRaw.enabled);
      const dbs = [
        ...(notionCfg.database_id ? [notionCfg.database_id] : []),
        ...(Array.isArray(notionRaw.known_databases) ? notionRaw.known_databases : []),
      ];
      targets = [...new Set(dbs.filter(Boolean))];
    } else if (source === 'gmail') {
      const gmailRaw = readRawYaml(meetingIngestionConfigPath(root))?.gmail ?? {};
      enabled = enabled || Boolean(gmailRaw.enabled);
      targets = gmailRaw.query ? [gmailRaw.query] : [];
    }

    const configuredMode = policySource.x_mode
      || (enabled ? (creds.ready ? 'api-token' : 'agent-mcp') : 'unconfigured');

    const wm = watermarks[source] ?? null;
    const lastPolledAt = wm?.last_polled_at ?? null;
    const lastMs = lastPolledAt ? Date.parse(lastPolledAt) : NaN;
    const ageMinutes = Number.isFinite(lastMs) ? Math.max(0, Math.round((now - lastMs) / 60_000)) : null;
    const staleReason = !enabled
      ? null
      : !lastPolledAt || !Number.isFinite(lastMs)
        ? 'never_polled'
        : ageMinutes > maxAgeMinutes
          ? 'stale'
          : null;

    return {
      source,
      enabled,
      mode: configuredMode,
      credentials_ready: creds.ready,
      required_env_keys: creds.required_env_keys,
      present_env_keys: creds.present_env_keys,
      missing_env_keys: creds.missing_env_keys,
      targets,
      last_polled_at: lastPolledAt,
      age_minutes: ageMinutes,
      stale: Boolean(staleReason),
      stale_reason: staleReason,
    };
  });
}

export function checkStaleConnectors(repoRoot, options = {}) {
  return resolveConnectorList(repoRoot, options)
    .filter((item) => item.enabled && item.stale)
    .map((item) => ({
      source: item.source,
      mode: item.mode,
      last_polled_at: item.last_polled_at,
      age_minutes: item.age_minutes,
      stale_reason: item.stale_reason,
    }));
}

export function inspectConnectorsStatus(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const connectors = resolveConnectorList(root, options);
  return {
    repo_root: root,
    connectors,
    enabled_sources: connectors.filter((c) => c.enabled).map((c) => c.source),
    stale_sources: connectors.filter((c) => c.enabled && c.stale).map((c) => c.source),
  };
}

export function renderSlackAppManifest({ botName = 'hey-desk' } = {}) {
  const cleanName = String(botName || 'hey-desk').trim();
  const manifest = {
    display_information: {
      name: cleanName,
      description: 'Team OS activity collector and desk notification app',
    },
    features: {
      bot_user: {
        display_name: cleanName,
        always_online: false,
      },
    },
    oauth_config: {
      scopes: {
        bot: [
          'channels:history',
          'channels:read',
          'groups:history',
          'groups:read',
          'im:history',
          'im:read',
          'im:write',
          'chat:write',
          'reactions:write',
          'users:read',
        ],
      },
    },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };

  return {
    source: 'slack',
    create_app_url: 'https://api.slack.com/apps?new_app=1',
    instructions: [
      'Open https://api.slack.com/apps?new_app=1 and choose "From an app manifest".',
      'Paste the JSON manifest below, install to your workspace, and copy the Bot User OAuth Token (xoxb-...).',
      'Run `./hey connector configure slack --mode api-token --set-env SLACK_BOT_TOKEN=xoxb-...` and then `./hey connector discover slack --json`.',
    ],
    manifest,
  };
}

export async function discoverConnectorTargets(repoRoot, source, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const normalizedSource = assertConnectorSource(source);
  const env = loadMergedEnv(root);

  if (normalizedSource === 'github') {
    const args = ['repo', 'list'];
    if (options.org) args.push(options.org);
    args.push('--limit', '30', '--json', 'nameWithOwner,isPrivate,updatedAt');
    const out = execFileSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 10000 });
    return {
      source: 'github',
      repos: JSON.parse(out),
    };
  }

  if (normalizedSource === 'slack') {
    if (!env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
    const { WebClient } = await import('@slack/web-api');
    const client = new WebClient(env.SLACK_BOT_TOKEN);
    const auth = await client.auth.test();
    const convs = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    });
    const users = await client.users.list({ limit: 200 });
    const roster = listMemberEntries(root).filter((m) => !['team', 'fisher', 'agent'].includes(m.name));
    const activeUsers = (users.members ?? []).filter((u) => !u.deleted && !u.is_bot);
    const suggestedMembers = roster.map((member) => {
      const match = activeUsers.find((u) => {
        const emailPrefix = String(u.profile?.email ?? '').split('@')[0]?.toLowerCase();
        const uname = String(u.name ?? '').toLowerCase();
        const display = String(u.profile?.display_name ?? '').toLowerCase();
        return emailPrefix === member.name || uname === member.name || display === member.name;
      });
      return {
        member: member.name,
        suggested_slack_user_id: match?.id ?? null,
        slack_name: match?.name ?? null,
      };
    });

    return {
      source: 'slack',
      workspace: auth.team,
      bot_user_id: auth.user_id,
      channels: (convs.channels ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        is_private: Boolean(c.is_private),
        is_member: Boolean(c.is_member),
      })),
      suggested_member_mappings: suggestedMembers,
    };
  }

  if (normalizedSource === 'drive') {
    const sa = loadGoogleServiceAccount(env);
    if (!sa) throw new Error('Missing Google service account credentials in .env');
    const auth = new GoogleServiceAccountAuth({
      scopes: DRIVE_SCOPES,
      serviceAccount: sa,
      subject: env.GOOGLE_IMPERSONATED_USER || '',
    });
    const token = await auth.accessToken();
    const foldersRes = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=mimeType%3D%27application%2Fvnd.google-apps.folder%27%20and%20trashed%3Dfalse&pageSize=30&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,driveId)',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!foldersRes.ok) throw new Error(`Drive API folders query failed (${foldersRes.status})`);
    const foldersJson = await foldersRes.json();

    const drivesRes = await fetch('https://www.googleapis.com/drive/v3/drives?pageSize=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const drivesJson = drivesRes.ok ? await drivesRes.json() : { drives: [] };

    return {
      source: 'drive',
      service_account_email: sa.client_email,
      sharing_hint: `Share target Drive folders with ${sa.client_email} as Viewer (read-only).`,
      folders: foldersJson.files ?? [],
      shared_drives: drivesJson.drives ?? [],
    };
  }

  if (normalizedSource === 'notion') {
    if (!env.NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: env.NOTION_TOKEN });
    const search = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 25,
    });
    return {
      source: 'notion',
      databases: (search.results ?? []).map((db) => ({
        id: db.id,
        title: (db.title ?? []).map((t) => t.plain_text ?? '').join('') || db.id,
        url: db.url ?? null,
      })),
    };
  }

  return {
    source: normalizedSource,
    hint: `No automated discovery endpoint for '${normalizedSource}'. Configure targets directly via ./hey connector configure ${normalizedSource}.`,
  };
}

function parseEnvUpdates(envUpdates) {
  if (!envUpdates) return {};
  if (!Array.isArray(envUpdates)) return envUpdates;
  const parsed = {};
  for (const item of envUpdates) {
    const str = String(item ?? '');
    const eq = str.indexOf('=');
    if (eq <= 0) {
      throw new Error(`Invalid --set-env entry '${str}'; expected KEY=VALUE`);
    }
    const key = str.slice(0, eq).trim();
    const val = str.slice(eq + 1);
    parsed[key] = val;
  }
  return parsed;
}

export function configureConnector(repoRoot, source, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const normalizedSource = assertConnectorSource(source);
  const mode = String(options.mode || 'api-token').trim().toLowerCase();
  if (!['api-token', 'agent-mcp'].includes(mode)) {
    throw new Error(`Invalid mode '${mode}'. Valid: api-token, agent-mcp`);
  }
  const enabled = options.enabled !== undefined ? Boolean(options.enabled) : true;

  const envUpdates = parseEnvUpdates(options.envUpdates);
  let envResult = { updated_keys: [] };
  if (Object.keys(envUpdates).length > 0) {
    envResult = upsertEnvVariables(resolve(root, '.env'), envUpdates);
  }

  const policyPath = externalActivityConfigPath(root);
  const policy = existsSync(policyPath) ? readRawYaml(policyPath) : { sources: {} };
  policy.sources = policy.sources ?? {};

  const fisherPath = externalActivityRuntimeConfigPath(root);
  const fisher = existsSync(fisherPath) ? readRawYaml(fisherPath) : {};

  const repos = parseCsvList(options.repos);
  const channels = parseCsvList(options.channels);
  const foldersRaw = parseCsvList(options.folders);
  const folders = foldersRaw ? foldersRaw.map(extractDriveFolderId).filter(Boolean) : null;
  const sharedDrives = parseCsvList(options.sharedDrives);
  const spaces = parseCsvList(options.spaces);
  const databases = parseCsvList(options.databases);

  if (['github', 'slack', 'drive', 'confluence'].includes(normalizedSource)) {
    policy.sources[normalizedSource] = {
      ...(policy.sources[normalizedSource] ?? {}),
      enabled,
      x_mode: mode,
    };
  } else {
    policy.sources[normalizedSource] = {
      ...(policy.sources[normalizedSource] ?? {}),
      enabled,
      x_mode: mode,
    };
  }

  if (normalizedSource === 'github') {
    if (repos) policy.sources.github.repos = repos;
    fisher.github = {
      ...(fisher.github ?? {}),
      enabled,
      ...(repos ? { repos } : {}),
    };
  } else if (normalizedSource === 'slack') {
    if (channels) {
      policy.sources.slack.channels = channels;
      const existingById = new Map(
        (fisher.collector?.channels ?? [])
          .filter((c) => c && typeof c === 'object' && c.id)
          .map((c) => [c.id, c]),
      );
      fisher.collector = {
        ...(fisher.collector ?? {}),
        channels: channels.map((id) => existingById.get(id) ?? { id, name: id, visibility: 'public' }),
      };
    }
  } else if (normalizedSource === 'drive') {
    if (sharedDrives) policy.sources.drive.shared_drives = sharedDrives;
    fisher.drive = {
      ...(fisher.drive ?? {}),
      enabled,
      ...(folders ? { folders } : {}),
      ...(sharedDrives ? { shared_drives: sharedDrives } : {}),
    };
  } else if (normalizedSource === 'confluence') {
    if (spaces) policy.sources.confluence.spaces = spaces;
    fisher.confluence = {
      ...(fisher.confluence ?? {}),
      enabled,
      ...(spaces ? { spaces: spaces.map((key) => ({ key, include_recent_pages: 25 })) } : {}),
    };
  }

  if (options.memberMappings && typeof options.memberMappings === 'object') {
    fisher.members = fisher.members ?? {};
    for (const [memberKey, mapping] of Object.entries(options.memberMappings)) {
      fisher.members[memberKey] = {
        ...(fisher.members[memberKey] ?? {}),
        ...mapping,
      };
    }
  }

  if (normalizedSource === 'notion' || normalizedSource === 'gmail') {
    const meetingPath = meetingIngestionConfigPath(root);
    const meeting = existsSync(meetingPath) ? readRawYaml(meetingPath) : {};
    if (normalizedSource === 'notion') {
      meeting.notion = {
        ...(meeting.notion ?? {}),
        enabled,
        ...(databases ? { database_id: databases[0] ?? '', known_databases: databases } : {}),
      };
    } else {
      meeting.gmail = {
        ...(meeting.gmail ?? {}),
        enabled,
        ...(options.query ? { query: options.query } : {}),
      };
    }
    writeYamlFile(meetingPath, meeting);

    const anyMeetingEnabled = Boolean(meeting.notion?.enabled || meeting.gmail?.enabled);
    fisher.meeting = {
      ...(fisher.meeting ?? {}),
      enabled: anyMeetingEnabled,
    };
  }

  writeYamlFile(policyPath, policy);
  writeYamlFile(fisherPath, fisher);

  return {
    ok: true,
    source: normalizedSource,
    enabled,
    mode,
    env_updated_keys: envResult.updated_keys,
    targets:
      repos ??
      channels ??
      (folders || sharedDrives ? [...(folders ?? []), ...(sharedDrives ?? [])] : null) ??
      spaces ??
      databases ??
      [],
  };
}

export async function testConnector(repoRoot, source) {
  const root = resolve(repoRoot ?? process.cwd());
  const normalizedSource = assertConnectorSource(source);
  const env = loadMergedEnv(root);
  const statusList = resolveConnectorList(root);
  const current = statusList.find((c) => c.source === normalizedSource);
  const mode = current?.mode === 'agent-mcp' ? 'agent-mcp' : 'api-token';

  if (mode === 'agent-mcp') {
    const stateDir = resolve(root, '.hey', 'external-activity');
    mkdirSync(stateDir, { recursive: true });
    return {
      ok: true,
      source: normalizedSource,
      mode: 'agent-mcp',
      detail: 'Agent MCP bridge ready; fetch 1-3 recent items via your host agent MCP/plugin and pipe JSON into `./hey activity push-events --stdin --prepare`.',
    };
  }

  if (normalizedSource === 'github') {
    const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 6000,
    }).trim();
    return { ok: true, source: 'github', mode: 'api-token', detail: `Authenticated via gh CLI as ${login}` };
  }

  if (normalizedSource === 'slack') {
    if (!env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
    const { WebClient } = await import('@slack/web-api');
    const auth = await new WebClient(env.SLACK_BOT_TOKEN).auth.test();
    return { ok: true, source: 'slack', mode: 'api-token', detail: `Connected to Slack workspace '${auth.team}' as ${auth.user}` };
  }

  if (normalizedSource === 'drive') {
    const sa = loadGoogleServiceAccount(env);
    if (!sa) throw new Error('Missing Google service account credentials');
    const auth = new GoogleServiceAccountAuth({
      scopes: DRIVE_SCOPES,
      serviceAccount: sa,
      subject: env.GOOGLE_IMPERSONATED_USER || '',
    });
    const token = await auth.accessToken();
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=3&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name)',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Drive API list check failed (${res.status})`);
    const data = await res.json();
    return {
      ok: true,
      source: 'drive',
      mode: 'api-token',
      detail: `Service account ${sa.client_email} authenticated (${(data.files ?? []).length} sample file(s) visible)`,
    };
  }

  if (normalizedSource === 'notion') {
    if (!env.NOTION_TOKEN) throw new Error('Missing NOTION_TOKEN');
    const { Client } = await import('@notionhq/client');
    const notion = new Client({ auth: env.NOTION_TOKEN });
    const me = await notion.users.me({});
    return { ok: true, source: 'notion', mode: 'api-token', detail: `Connected Notion bot '${me.name || me.id}'` };
  }

  if (normalizedSource === 'gmail') {
    if (!env.GMAIL_CLIENT_ID || !env.GMAIL_CLIENT_SECRET || !env.GMAIL_REFRESH_TOKEN) {
      throw new Error('Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN');
    }
    const { google } = await import('googleapis');
    const oauth2 = new google.auth.OAuth2(env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: env.GMAIL_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: env.GMAIL_USER || 'me' });
    return {
      ok: true,
      source: 'gmail',
      mode: 'api-token',
      detail: `Authenticated Gmail for ${profile.data.emailAddress}`,
    };
  }

  if (normalizedSource === 'confluence') {
    if (!env.ATLASSIAN_EMAIL || !env.ATLASSIAN_API_TOKEN || !env.ATLASSIAN_BASE_URL) {
      throw new Error('Missing ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, or ATLASSIAN_BASE_URL');
    }
    const authHeader = `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64')}`;
    const base = String(env.ATLASSIAN_BASE_URL).replace(/\/$/, '');
    const res = await fetch(`${base}/wiki/rest/api/space?limit=3`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Confluence API check failed (${res.status})`);
    const data = await res.json();
    return {
      ok: true,
      source: 'confluence',
      mode: 'api-token',
      detail: `Authenticated Confluence (${(data.results ?? []).length} sample space(s) visible)`,
    };
  }

  throw new Error(`Unsupported source: ${normalizedSource}`);
}
