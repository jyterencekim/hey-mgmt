import { resolve } from 'node:path';
import { createGoogleOAuthClient } from './google-auth.mjs';
import { loadMeetingIngestionConfig } from './config.mjs';
import { listGeminiNotificationMessages } from './gmail.mjs';
import { fetchGoogleDocSnapshot } from './google-docs.mjs';
import { createNotionClient, listNotionMeetingSnapshots } from './notion.mjs';
import { applyMeetingSnapshot } from './writer.mjs';
import { readMeetingSyncState, writeMeetingSyncState } from './state.mjs';
import { finalizeMeetingGitSync, prepareMeetingGitSync } from './git-sync.mjs';
import { notifyMeeting } from '../meeting-notify.mjs';

function maxUpdatedAt(entries) {
  return entries
    .map((entry) => entry?.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function effectiveSince(explicitSince, stateSince) {
  return explicitSince ?? stateSince ?? null;
}

function buildStubSnapshotFromMessage(message, config, error = null) {
  return {
    ...message,
    owner: config.defaults?.default_owner ?? 'alice',
    attendees: [],
    external_attendees: [],
    notes_md: '',
    action_items: [],
    parse_status: error ? 'pending_fetch' : (message.parse_status ?? 'pending_fetch'),
    sync_error: error?.message ?? null,
  };
}

function notificationPaths(actions) {
  return actions.flatMap((action) => action?.notification?.sent?.map((entry) => entry.path) ?? []);
}

function runGitSyncIfNeeded({ repoRoot, gitSync, dryRun, commitLabel, actions = [] }) {
  if (!gitSync) return null;
  if (dryRun) {
    throw new Error('--git-sync cannot be combined with --dry-run');
  }
  return finalizeMeetingGitSync({
    repoRoot,
    commitLabel,
    notificationPaths: notificationPaths(actions),
  });
}

export async function notifyMeetingAction({ repoRoot, action, dryRun }) {
  if (dryRun || action?.result?.artifact_type !== 'meeting' || !action.result.artifact_path) {
    return action;
  }
  action.notification = await notifyMeeting({
    repoRoot,
    meetingPath: resolve(repoRoot, action.result.artifact_path),
  });
  return action;
}

export async function importGmailMeetings({
  repoRoot,
  since = null,
  limit = 20,
  dryRun = false,
  gitSync = false,
  auth = null,
  gmailService = null,
  docsService = null,
  driveService = null,
}) {
  const config = loadMeetingIngestionConfig(repoRoot);
  if (config.gmail?.enabled === false) {
    return {
      source: 'gmail',
      since: since ?? null,
      imported: 0,
      actions: [],
      skipped: true,
      reason: 'disabled',
      git_sync: null,
    };
  }
  const state = readMeetingSyncState(repoRoot);
  const effective = effectiveSince(since, state.gmail?.last_success_at);
  if (gitSync && !dryRun) {
    prepareMeetingGitSync({ repoRoot });
  }
  const googleAuth = auth ?? createGoogleOAuthClient();
  const messages = await listGeminiNotificationMessages({
    auth: googleAuth,
    config,
    since: effective,
    limit,
    gmailService,
  });

  const actions = [];
  for (const message of messages) {
    let snapshot;
    try {
      snapshot = await fetchGoogleDocSnapshot({
        auth: googleAuth,
        config,
        googleDocId: message.google_doc_id,
        googleFileId: message.google_file_id,
        fallbackTitle: message.title,
        fallbackDateText: message.fallback_date_text,
        gmailMessage: message,
        docsService,
        driveService,
      });
    } catch (error) {
      snapshot = buildStubSnapshotFromMessage(message, config, error);
    }

    if (!snapshot.owner) {
      snapshot.owner = config.defaults?.default_owner ?? 'alice';
    }
    const action = applyMeetingSnapshot({ repoRoot, config, snapshot, dryRun });
    actions.push(await notifyMeetingAction({ repoRoot, action, dryRun }));
  }

  if (!dryRun && actions.length > 0) {
    state.gmail.last_success_at = maxUpdatedAt(messages) ?? new Date().toISOString();
    writeMeetingSyncState(repoRoot, state);
  }

  const git = runGitSyncIfNeeded({
    repoRoot,
    gitSync,
    dryRun,
    commitLabel: `meeting-sync: gmail ${new Date().toISOString()}`,
    actions,
  });

  return {
    source: 'gmail',
    since: effective,
    imported: messages.length,
    actions,
    git_sync: git,
  };
}

export async function importNotionMeetings({
  repoRoot,
  since = null,
  limit = 20,
  dryRun = false,
  gitSync = false,
  notion = null,
}) {
  const config = loadMeetingIngestionConfig(repoRoot);
  if (config.notion?.enabled === false) {
    return {
      source: 'notion',
      since: since ?? null,
      imported: 0,
      actions: [],
      skipped: true,
      reason: 'disabled',
      git_sync: null,
    };
  }
  const state = readMeetingSyncState(repoRoot);
  const effective = effectiveSince(since, state.notion?.last_success_at);
  if (gitSync && !dryRun) {
    prepareMeetingGitSync({ repoRoot });
  }
  const notionClient = notion ?? createNotionClient();
  const snapshots = await listNotionMeetingSnapshots({
    notion: notionClient,
    config,
    since: effective,
    limit,
  });

  const actions = [];
  for (const snapshot of snapshots) {
    const action = applyMeetingSnapshot({ repoRoot, config, snapshot, dryRun });
    actions.push(await notifyMeetingAction({ repoRoot, action, dryRun }));
  }
  if (!dryRun && snapshots.length > 0) {
    state.notion.last_success_at = maxUpdatedAt(snapshots) ?? new Date().toISOString();
    writeMeetingSyncState(repoRoot, state);
  }

  const git = runGitSyncIfNeeded({
    repoRoot,
    gitSync,
    dryRun,
    commitLabel: `meeting-sync: notion ${new Date().toISOString()}`,
    actions,
  });

  return {
    source: 'notion',
    since: effective,
    imported: snapshots.length,
    actions,
    git_sync: git,
  };
}

export async function importAllMeetings({
  repoRoot,
  since = null,
  limit = 20,
  dryRun = false,
  gitSync = false,
  auth = null,
  gmailService = null,
  docsService = null,
  driveService = null,
  notion = null,
}) {
  if (gitSync && !dryRun) {
    prepareMeetingGitSync({ repoRoot });
  }
  const config = loadMeetingIngestionConfig(repoRoot);
  const gmail = await importGmailMeetings({
    repoRoot,
    since,
    limit,
    dryRun,
    gitSync: false,
    auth,
    gmailService,
    docsService,
    driveService,
  });
  const notionResult = config.notion?.enabled === false
    ? {
        source: 'notion',
        since: since ?? null,
        imported: 0,
        actions: [],
        skipped: true,
        reason: 'disabled',
        git_sync: null,
      }
    : await importNotionMeetings({
        repoRoot,
        since,
        limit,
        dryRun,
        gitSync: false,
        notion,
      });

  const git = runGitSyncIfNeeded({
    repoRoot,
    gitSync,
    dryRun,
    commitLabel: `meeting-sync: gmail+notion ${new Date().toISOString()}`,
    actions: [...gmail.actions, ...notionResult.actions],
  });

  return {
    source: 'all',
    gmail,
    notion: notionResult,
    git_sync: git,
  };
}
