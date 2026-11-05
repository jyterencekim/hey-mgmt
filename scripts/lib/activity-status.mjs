import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readObservations } from './activity-observations.mjs';
import { loadMergedKnowledgeEntries } from './activity-state.mjs';

/**
 * Gather Fisher pipeline health data.
 * Returns a structured status object.
 */
export function gatherStatus(repoRoot, config) {
  const now = new Date();
  const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);

  return {
    timestamp: now.toISOString(),
    kst_date: kstDate,
    sources: gatherSourceStatus(repoRoot),
    knowledge: gatherKnowledgeStatus(repoRoot),
    observations: gatherObservationStatus(repoRoot, kstDate),
    config: gatherConfigSummary(config),
  };
}

/**
 * Get last event time per source from events.jsonl.
 * Reads last 500 lines for efficiency.
 */
function gatherSourceStatus(repoRoot) {
  const eventsPath = resolve(repoRoot, '.hey', 'external-activity', 'events.jsonl');
  if (!existsSync(eventsPath)) return buildEmptySources();

  const content = readFileSync(eventsPath, 'utf8');
  const lines = content.trim().split('\n');
  const recent = lines.slice(-500);

  const lastBySource = {};
  const countBySource = {};

  for (const line of recent) {
    try {
      const event = JSON.parse(line);
      const src = event.source;
      if (!src) continue;
      countBySource[src] = (countBySource[src] ?? 0) + 1;
      const changedAt = event.changed_at;
      if (changedAt && (!lastBySource[src] || changedAt > lastBySource[src])) {
        lastBySource[src] = changedAt;
      }
    } catch { /* skip malformed */ }
  }

  const now = Date.now();
  const sources = {};
  for (const src of ['slack', 'confluence', 'drive', 'github']) {
    const lastAt = lastBySource[src] ?? null;
    const ageMs = lastAt ? now - Date.parse(lastAt) : null;
    const ageHours = ageMs !== null ? Math.round(ageMs / 3600000 * 10) / 10 : null;
    sources[src] = {
      last_event_at: lastAt,
      age_hours: ageHours,
      recent_count: countBySource[src] ?? 0,
      stale: ageHours !== null ? ageHours > 1 : true,
    };
  }
  return sources;
}

function buildEmptySources() {
  const sources = {};
  for (const src of ['slack', 'confluence', 'drive', 'github']) {
    sources[src] = { last_event_at: null, age_hours: null, recent_count: 0, stale: true };
  }
  return sources;
}

function gatherKnowledgeStatus(repoRoot) {
  const now = new Date();
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = kstNow.toISOString().slice(0, 7);
  const counts = { indexed: 0, pending: 0, linked: 0, rejected: 0, revoked: 0, total: 0 };

  for (const entry of loadMergedKnowledgeEntries(repoRoot).filter((item) => String(item.date ?? '').startsWith(month))) {
    const status = entry.status ?? 'unknown';
    if (status in counts) counts[status]++;
    counts.total++;
  }
  return counts;
}

/**
 * Count today's observations by tier.
 */
function gatherObservationStatus(repoRoot, kstDate) {
  const entries = readObservations(repoRoot, kstDate);
  return {
    date: kstDate,
    promoted: entries.filter(e => e.tier === 'promoted').length,
    observed: entries.filter(e => e.tier === 'observed').length,
    total: entries.length,
  };
}

/**
 * Summarize relevant config.
 */
function gatherConfigSummary(config) {
  return {
    reflection_enabled: config.reflection?.enabled ?? false,
    promotion_threshold: config.reflection?.promotion_confidence_threshold ?? 0.8,
    observation_threshold: config.reflection?.observation_confidence_threshold ?? 0.5,
    digest_enabled: config.digest?.enabled ?? false,
    digest_schedule: config.digest?.schedule ?? [],
    digest_channel: config.digest?.channel ?? null,
  };
}

/**
 * Build Slack Block Kit blocks for the status report.
 */
export function buildStatusBlocks(status) {
  const blocks = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: 'Fisher Status Report' },
  });

  const sourceLines = [];
  for (const [src, data] of Object.entries(status.sources)) {
    const icon = data.stale ? ':warning:' : ':white_check_mark:';
    const age = data.age_hours !== null ? `${data.age_hours}h ago` : 'no events';
    sourceLines.push(`${icon} *${src}*: ${age} (${data.recent_count} recent)`);
  }
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Source Health*\n' + sourceLines.join('\n') },
  });

  const k = status.knowledge;
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Knowledge (${status.kst_date.slice(0, 7)})*\n`
        + `Total: ${k.total} | Linked: ${k.linked} | Indexed: ${k.indexed} | Revoked: ${k.revoked} | Rejected: ${k.rejected}`,
    },
  });

  const obs = status.observations;
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*Observations (${obs.date})*\n`
        + `Promoted: ${obs.promoted} | Observed: ${obs.observed} | Total: ${obs.total}`,
    },
  });

  const cfg = status.config;
  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: `Reflection: ${cfg.reflection_enabled ? 'on' : 'off'} (promote ≥${cfg.promotion_threshold}, observe ≥${cfg.observation_threshold})`
        + ` | Digest: ${cfg.digest_enabled ? cfg.digest_schedule.join(', ') + ' KST' : 'off'}`,
    }],
  });

  return blocks;
}
