import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_STATE = {
  gmail: {
    last_success_at: null,
  },
  notion: {
    last_success_at: null,
  },
};

export function meetingSyncStatePath(repoRoot) {
  return resolve(repoRoot, '.hey', 'meeting-sync', 'state.json');
}

export function readMeetingSyncState(repoRoot) {
  const path = meetingSyncStatePath(repoRoot);
  if (!existsSync(path)) return structuredClone(DEFAULT_STATE);
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return {
    ...structuredClone(DEFAULT_STATE),
    ...parsed,
    gmail: { ...DEFAULT_STATE.gmail, ...(parsed.gmail ?? {}) },
    notion: { ...DEFAULT_STATE.notion, ...(parsed.notion ?? {}) },
  };
}

export function writeMeetingSyncState(repoRoot, state) {
  const path = meetingSyncStatePath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return path;
}
