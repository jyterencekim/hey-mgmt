import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadExternalActivityConfig } from './activity-config.mjs';
import { appendEventHistory, compactKnowledgeEntries, inspectKnowledgeCompaction, listCandidates, updateKnowledgeEntryStatus } from './activity-state.mjs';
import { loadActivityEventsFromFile, normalizeActivityEvent } from './activity-events.mjs';
import { ingestWorkspaceLogEvents } from './activity-log.mjs';
import { applyApprovedCandidate, generateContentUpdateCandidates, rejectContentUpdateCandidate, prepareCandidatesForAgent, finalizeAgentDecisions, finalizeReflectionDecisions } from './activity-candidates.mjs';
import { demoteObservation, deleteObservation, readObservations } from './activity-observations.mjs';
import { loadExternalActivityRuntimeConfig, loadEnvFile, loadHermesSlackToken } from '../../workspace/fisher/external-activity-runtime/lib/config.mjs';
import { gitPull, gitCommitAndPush } from '../../workspace/fisher/external-activity-runtime/lib/git-sync.mjs';

export async function ingestActivityEvents({ repoRoot, events }) {
  const config = loadExternalActivityConfig(repoRoot);
  const normalizedEvents = events.map(normalizeActivityEvent);
  appendEventHistory(repoRoot, config, normalizedEvents);
  const logResults = ingestWorkspaceLogEvents({ repoRoot, config, events: normalizedEvents });
  const candidates = await generateContentUpdateCandidates({ repoRoot, config, events: normalizedEvents });
  return {
    event_count: normalizedEvents.length,
    log_results: logResults,
    candidate_count: candidates.length,
    candidates,
  };
}

export async function ingestActivityFile({ repoRoot, filePath }) {
  const config = loadExternalActivityConfig(repoRoot);
  const events = loadActivityEventsFromFile(readFileSync(filePath, 'utf8'));
  appendEventHistory(repoRoot, config, events);
  const logResults = ingestWorkspaceLogEvents({ repoRoot, config, events });
  const candidates = await generateContentUpdateCandidates({ repoRoot, config, events });
  return {
    event_count: events.length,
    log_results: logResults,
    candidate_count: candidates.length,
    candidates,
  };
}

export function getActivityCandidates({ repoRoot, status = null }) {
  const config = loadExternalActivityConfig(repoRoot);
  return listCandidates(repoRoot, config, status);
}

export function approveActivityCandidate({ repoRoot, candidateId }) {
  const config = loadExternalActivityConfig(repoRoot);
  return applyApprovedCandidate({ repoRoot, config, candidateId });
}

export function rejectActivityCandidateById({ repoRoot, candidateId }) {
  const config = loadExternalActivityConfig(repoRoot);
  return rejectContentUpdateCandidate({ repoRoot, config, candidateId });
}

// ── Poll-only collection (no candidate generation) ──────────────────────────

function loadFisherEnv(repoRoot) {
  for (const envPath of [
    resolve(repoRoot, '.env'),
    resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env'),
  ]) {
    if (existsSync(envPath)) loadEnvFile(envPath);
  }
  // Hermes owns the Slack credential; cron subprocesses do not inherit its dotenv.
  // Load only this collector's token rather than importing all Hermes secrets.
  loadHermesSlackToken();
}

function pollOnlyIngest({ repoRoot }) {
  const config = loadExternalActivityConfig(repoRoot);
  return async function ingestEventsWithoutCandidates({ repoRoot: r, events }) {
    const normalized = events.map(normalizeActivityEvent);
    appendEventHistory(r, config, normalized);
    const logResults = ingestWorkspaceLogEvents({ repoRoot: r, config, events: normalized });
    return {
      event_count: normalized.length,
      log_results: logResults,
      candidate_count: 0,
      candidates: [],
      events: normalized,
    };
  };
}

async function createCollector(repoRoot, source, fisherConfig, ingestEvents) {
  switch (source) {
    case 'slack': {
      const { SlackCollector } = await import('../../workspace/fisher/external-activity-runtime/lib/slack-collector.mjs');
      if (!process.env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
      return new SlackCollector({ repoRoot, config: fisherConfig, ingestEvents });
    }
    case 'confluence': {
      const { ConfluenceCollector } = await import('../../workspace/fisher/external-activity-runtime/lib/confluence-collector.mjs');
      if (!process.env.ATLASSIAN_EMAIL || !process.env.ATLASSIAN_API_TOKEN || !process.env.ATLASSIAN_BASE_URL) {
        throw new Error('Missing Atlassian credentials (ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, ATLASSIAN_BASE_URL)');
      }
      return new ConfluenceCollector({ repoRoot, config: fisherConfig, ingestEvents });
    }
    case 'drive': {
      const { DriveCollector } = await import('../../workspace/fisher/external-activity-runtime/lib/drive-collector.mjs');
      const { loadGoogleServiceAccount } = await import('../../workspace/fisher/external-activity-runtime/lib/google-auth.mjs');
      if (!loadGoogleServiceAccount(process.env)) {
        throw new Error(
          'Missing Google Service Account credentials (set GOOGLE_SERVICE_ACCOUNT_JSON_PATH, GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)',
        );
      }
      return new DriveCollector({ repoRoot, config: fisherConfig, ingestEvents });
    }
    case 'github': {
      const { GitHubCollector } = await import('../../workspace/fisher/external-activity-runtime/lib/github-collector.mjs');
      return new GitHubCollector({ repoRoot, config: fisherConfig, ingestEvents });
    }
    default:
      throw new Error(`Unknown source: ${source}. Valid sources: slack, confluence, drive, github`);
  }
}

export async function pollOnlySource({ repoRoot, source }) {
  loadFisherEnv(repoRoot);
  const fisherConfig = loadExternalActivityRuntimeConfig(repoRoot);
  const ingestEvents = pollOnlyIngest({ repoRoot });

  if (source === 'meeting') {
    const { importAllMeetings } = await import('./meeting-sync/importer.mjs');
    const result = await importAllMeetings({ repoRoot, limit: 20, dryRun: false, gitSync: false });
    return { source: 'meeting', ...result };
  }

  const collector = await createCollector(repoRoot, source, fisherConfig, ingestEvents);
  const result = await collector.pollOnce();
  return { source, ...result };
}

export async function pollSource({ repoRoot, source }) {
  await gitPull(repoRoot);
  const result = await pollOnlySource({ repoRoot, source });
  gitCommitAndPush(repoRoot, `activity: poll ${source}`);
  return result;
}

// ── Prepare candidates: exact match + return unmatched for agent ──────────────

function readRecentEvents(repoRoot, config, maxAgeDays = 1) {
  const historyPath = resolve(repoRoot, config.runtime?.state_dir ?? '.hey/external-activity', 'events.jsonl');
  if (!existsSync(historyPath)) return [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const lines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
  const events = [];
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.changed_at && Date.parse(event.changed_at) >= cutoff) events.push(event);
    } catch { /* skip malformed */ }
  }
  return events;
}

export async function prepareCandidates({ repoRoot, eventsJson }) {
  const config = loadExternalActivityConfig(repoRoot);
  await gitPull(repoRoot);
  const events = eventsJson
    ? (typeof eventsJson === 'string' ? JSON.parse(eventsJson) : eventsJson)
    : readRecentEvents(repoRoot, config);
  const result = prepareCandidatesForAgent({ repoRoot, config, events });
  gitCommitAndPush(repoRoot, 'activity: prepare-candidates');
  return result;
}

// ── Finalize candidates: write candidates from agent decisions ────────────────

export async function finalizeCandidatesFromAgent({ repoRoot, decisionsJson }) {
  const config = loadExternalActivityConfig(repoRoot);
  const decisions = typeof decisionsJson === 'string' ? JSON.parse(decisionsJson) : decisionsJson;
  if (!Array.isArray(decisions?.decisions)) {
    throw new Error('Invalid decisions format: expected { decisions: [...] }');
  }
  await gitPull(repoRoot);
  const result = finalizeAgentDecisions({ repoRoot, config, decisions: decisions.decisions });
  gitCommitAndPush(repoRoot, 'activity: finalize-candidates');
  return result;
}

export async function finalizeReflections({ repoRoot, decisionsJson }) {
  const config = loadExternalActivityConfig(repoRoot);
  const decisions = typeof decisionsJson === 'string' ? JSON.parse(decisionsJson) : decisionsJson;
  const items = Array.isArray(decisions?.decisions) ? decisions.decisions : (Array.isArray(decisions) ? decisions : []);
  await gitPull(repoRoot);
  const result = finalizeReflectionDecisions({ repoRoot, config, decisions: items });
  gitCommitAndPush(repoRoot, 'activity: finalize-reflections');
  return result;
}

const DEFAULT_KNOWLEDGE_COMPACTION = {
  enabled: true,
  min_interval_hours: 24,
  max_interval_hours: 168,
  min_superseded_rows: 500,
  min_superseded_ratio: 0.2,
  min_periodic_superseded_rows: 50,
};

function knowledgeCompactionConfig(config) {
  return {
    ...DEFAULT_KNOWLEDGE_COMPACTION,
    ...(config.knowledge_compaction ?? {}),
  };
}

function knowledgeCompactionStatePath(repoRoot, config) {
  return resolve(repoRoot, config.runtime?.state_dir ?? '.hey/external-activity', 'knowledge-compaction.json');
}

function readKnowledgeCompactionState(repoRoot, config) {
  const path = knowledgeCompactionStatePath(repoRoot, config);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function writeKnowledgeCompactionState(repoRoot, config, state) {
  const path = knowledgeCompactionStatePath(repoRoot, config);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function hoursSince(timestamp, now) {
  const ms = Date.parse(timestamp ?? '');
  if (Number.isNaN(ms)) return Infinity;
  return (now.getTime() - ms) / 3_600_000;
}

export function evaluateKnowledgeCompaction({ config = {}, state = {}, stats, now = new Date(), force = false }) {
  const options = knowledgeCompactionConfig(config);
  const lastCompactedHours = hoursSince(state.last_compacted_at, now);

  if (!options.enabled && !force) {
    return { should_compact: false, reason: 'disabled', options };
  }
  if (!stats || stats.raw_rows === 0) {
    return { should_compact: false, reason: 'empty', options };
  }
  if (stats.superseded_rows === 0 && !force) {
    return { should_compact: false, reason: 'no_superseded_rows', options };
  }
  if (!force && lastCompactedHours < options.min_interval_hours) {
    return { should_compact: false, reason: 'cooldown', options };
  }
  if (force) {
    return { should_compact: true, reason: 'forced', options };
  }
  if (
    stats.superseded_rows >= options.min_superseded_rows &&
    stats.superseded_ratio >= options.min_superseded_ratio
  ) {
    return { should_compact: true, reason: 'threshold', options };
  }
  if (
    lastCompactedHours >= options.max_interval_hours &&
    stats.superseded_rows >= options.min_periodic_superseded_rows
  ) {
    return { should_compact: true, reason: 'periodic', options };
  }
  return { should_compact: false, reason: 'below_threshold', options };
}

export async function autoCompactKnowledge({ repoRoot, force = false }) {
  const config = loadExternalActivityConfig(repoRoot);
  await gitPull(repoRoot);

  const state = readKnowledgeCompactionState(repoRoot, config);
  const before = inspectKnowledgeCompaction(repoRoot);
  const decision = evaluateKnowledgeCompaction({ config, state, stats: before, force });
  const checkedAt = new Date().toISOString();

  if (!decision.should_compact) {
    writeKnowledgeCompactionState(repoRoot, config, {
      ...state,
      last_checked_at: checkedAt,
      last_decision: decision.reason,
      last_stats: before,
    });
    return { compacted: false, decision, before };
  }

  const compaction = compactKnowledgeEntries(repoRoot);
  const after = inspectKnowledgeCompaction(repoRoot);
  writeKnowledgeCompactionState(repoRoot, config, {
    ...state,
    last_checked_at: checkedAt,
    last_compacted_at: checkedAt,
    last_decision: decision.reason,
    last_stats: before,
    last_result: compaction,
  });
  gitCommitAndPush(repoRoot, 'activity: compact knowledge');
  return { compacted: true, decision, before, compaction, after };
}

export function revokePromotion({ repoRoot, date, signature }) {
  const demoted = demoteObservation(repoRoot, date, signature);
  if (demoted) {
    updateKnowledgeEntryStatus(repoRoot, signature, 'revoked', null);
  }
  return { revoked: demoted, signature, date };
}

export function deleteObservationById({ repoRoot, date, signature }) {
  const removed = deleteObservation(repoRoot, date, signature);
  if (removed) {
    updateKnowledgeEntryStatus(repoRoot, signature, 'rejected', null);
  }
  return { deleted: removed, signature, date };
}

export function getDigestData({ repoRoot, date }) {
  const observations = readObservations(repoRoot, date);
  return {
    date,
    promoted: observations.filter(o => o.tier === 'promoted'),
    observed: observations.filter(o => o.tier === 'observed'),
  };
}

export function digestStatePath({ repoRoot, channel, date, schedule }) {
  const safeChannel = String(channel ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeSchedule = String(schedule ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(repoRoot, '.hey', 'external-activity', 'digest-posts', `${date}__${safeChannel}__${safeSchedule}.json`);
}

export function loadDigestState({ repoRoot, channel, date, schedule }) {
  const path = digestStatePath({ repoRoot, channel, date, schedule });
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveDigestState({ repoRoot, channel, date, schedule, payload }) {
  const path = digestStatePath({ repoRoot, channel, date, schedule });
  mkdirSync(resolve(repoRoot, '.hey', 'external-activity', 'digest-posts'), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return path;
}
