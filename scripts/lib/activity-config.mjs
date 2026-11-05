import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEFAULT_CONFIG = {
  sources: {
    slack: { enabled: true, mode: 'polling', interval_minutes: 5, channels: [], dm_scope: 'people_and_bot_dm', degrade_to_bot_dm_only: true },
    jira: { enabled: true, interval_minutes: 10, projects: [] },
    confluence: { enabled: true, interval_minutes: 10, spaces: [] },
    drive: { enabled: true, interval_minutes: 10, shared_drives: [], file_types: ['google-doc', 'google-sheet', 'google-slide', 'pdf'] },
  },
  approval: {
    delivery: 'owner_dm',
    artifact_owner_fallback: 'alice',
    pr_strategy: 'per_change',
  },
  logging: {
    workspace_routing: 'actor',
    fallback_workspace: 'alice',
    coalescing_key: ['source', 'object_id', 'kst_date'],
  },
  matching: {
    policy: 'exact_x_external_refs',
    extension_field: 'x_external_refs',
    llm_match_enabled: true,
    llm_match_confidence_threshold: 0.7,
    llm_match_candidate_limit: 25,
  },
  distill: {
    enabled: true,
    min_signal_score: 3,
    suppress_low_signal_unmatched_sources: ['slack', 'jira'],
  },
  runtime: {
    state_dir: '.hey/external-activity',
    socket_mode: true,
    cloudflare_tunnel_required: false,
  },
  idempotency: {
    prepared_ttl_hours: 6,
  },
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
    delete_previous: true,
    max_headline_bullets: 10,
  },
  knowledge_compaction: {
    enabled: true,
    min_interval_hours: 24,
    max_interval_hours: 168,
    min_superseded_rows: 500,
    min_superseded_ratio: 0.2,
    min_periodic_superseded_rows: 50,
  },
};

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override ?? base;
  }

  if (base && typeof base === 'object' && override && typeof override === 'object') {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) {
      merged[key] = mergeDeep(base[key], value);
    }
    return merged;
  }

  return override ?? base;
}

export function externalActivityConfigPath(repoRoot) {
  return resolve(repoRoot, 'content', 'policies', 'external-activity.yml');
}

export function loadExternalActivityConfig(repoRoot) {
  const path = externalActivityConfigPath(repoRoot);
  if (!existsSync(path)) {
    return DEFAULT_CONFIG;
  }

  const parsed = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return mergeDeep(DEFAULT_CONFIG, parsed);
}
