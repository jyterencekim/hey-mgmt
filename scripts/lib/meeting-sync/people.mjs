import { lower, uniqueStrings } from './common.mjs';

function memberEntries(config) {
  return Object.entries(config.members ?? {});
}

export function buildMemberAliasMap(config) {
  const map = new Map();
  for (const [memberKey, entry] of memberEntries(config)) {
    map.set(lower(memberKey), memberKey);
    for (const address of entry.gmail_addresses ?? []) {
      map.set(lower(address), memberKey);
    }
    for (const alias of entry.notion_people ?? []) {
      map.set(lower(alias), memberKey);
    }
  }
  return map;
}

function normalizeRawPerson(value) {
  return String(value ?? '')
    .replace(/^mailto:/i, '')
    .replace(/^@/, '')
    .trim();
}

export function mapPeopleValues(values, config) {
  const aliasMap = buildMemberAliasMap(config);
  const internal = [];
  const external = [];

  for (const raw of uniqueStrings(values)) {
    const value = normalizeRawPerson(raw);
    if (!value) continue;
    const key = aliasMap.get(lower(value));
    if (key) {
      internal.push(key);
    } else {
      external.push(value);
    }
  }

  return {
    attendees: uniqueStrings(internal),
    external_attendees: uniqueStrings(external),
  };
}

export function resolveOwner(value, config, fallback) {
  const mapped = mapPeopleValues([value], config).attendees[0];
  return mapped ?? fallback;
}
