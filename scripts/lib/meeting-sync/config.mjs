import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const DEFAULT_CONFIG = {
  defaults: {
    timezone: 'Asia/Seoul',
    default_owner: 'alice',
    default_project: 'Team',
    meeting_status: 'active',
    note_status: 'active',
  },
  gmail: {
    enabled: true,
    user: '',
    query: 'from:gemini-notes@google.com subject:"Notes:"',
    label_ids: [],
    allowed_sender: 'gemini-notes@google.com',
    subject_prefix: 'Notes:',
    link_priority: ['open_meeting_notes', 'attachment'],
  },
  notion: {
    enabled: false,
    database_id: '',
    properties: {
      title: 'Title',
      start_at: 'Start',
      end_at: 'End',
      attendees: 'Attendees',
      owner: 'Owner',
      calendar_event_id: 'Calendar Event ID',
      source_url: 'Source URL',
    },
  },
  matching: {
    start_tolerance_minutes: 180,
  },
  members: {},
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

export function meetingIngestionConfigPath(repoRoot) {
  return resolve(repoRoot, 'content', 'policies', 'meeting-ingestion.yml');
}

export function loadMeetingIngestionConfig(repoRoot) {
  const path = meetingIngestionConfigPath(repoRoot);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  const parsed = parseYaml(readFileSync(path, 'utf8')) ?? {};
  return mergeDeep(DEFAULT_CONFIG, parsed);
}
