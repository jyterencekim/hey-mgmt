import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Roster access for content/vocab/members.yml. Per-member commands must
 * validate against this before touching workspace/<member>/ — an unknown
 * member would otherwise mint (and auto-commit) a junk workspace.
 */
export function listMemberEntries(root) {
  try {
    const raw = readFileSync(resolve(root, 'content/vocab/members.yml'), 'utf8');
    const data = parseYaml(raw) ?? {};
    return Array.isArray(data.members) ? data.members.filter((m) => m && m.name) : [];
  } catch {
    return [];
  }
}

export function memberEntry(root, name) {
  return listMemberEntries(root).find((m) => m.name === name) ?? null;
}

export function assertKnownMember(root, name) {
  const entry = memberEntry(root, name);
  if (!entry) {
    const known = listMemberEntries(root).map((m) => m.name).join(', ');
    throw new Error(`unknown member '${name}' (not in content/vocab/members.yml: ${known})`);
  }
  return entry;
}
