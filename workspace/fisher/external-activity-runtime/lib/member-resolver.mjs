import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const NON_PERSON_MEMBER_KEYS = new Set(['team', 'agent', 'fisher', 'partner-finance']);

function readYamlFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  return parseYaml(readFileSync(path, 'utf8')) ?? fallback;
}

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function tokenize(value) {
  return normalizeToken(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function emailLocalPart(email) {
  const normalized = normalizeToken(email);
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0];
}

function loadVocabMemberKeys(repoRoot) {
  const membersPath = resolve(repoRoot, 'content', 'vocab', 'members.yml');
  const parsed = readYamlFile(membersPath, { members: [] });
  return (parsed.members ?? [])
    .map((member) => normalizeToken(member?.name))
    .filter(Boolean)
    .filter((memberKey) => !NON_PERSON_MEMBER_KEYS.has(memberKey));
}

function slackIdentityTokens(user) {
  const profile = user?.profile ?? {};
  const values = [
    user?.name,
    profile.display_name,
    profile.display_name_normalized,
    profile.real_name,
    profile.real_name_normalized,
    profile.email,
    emailLocalPart(profile.email),
  ];
  return new Set(values.flatMap(tokenize));
}

function memberAliasTokens(memberKey, member = {}) {
  const values = [
    memberKey,
    ...(Array.isArray(member.confluence_names) ? member.confluence_names : []),
    ...(Array.isArray(member.slack_aliases) ? member.slack_aliases : []),
    ...(Array.isArray(member.drive_emails) ? member.drive_emails.map(emailLocalPart) : []),
  ];
  return new Set(values.flatMap(tokenize));
}

function knownMemberKeys(config, repoRoot) {
  const configured = Object.keys(config?.members ?? {}).map(normalizeToken);
  const vocab = loadVocabMemberKeys(repoRoot);
  return [...new Set([...configured, ...vocab])].filter(Boolean);
}

export function inferMemberKeyFromSlackUser({ config, repoRoot, slackUserId, user = null }) {
  for (const [memberKey, member] of Object.entries(config?.members ?? {})) {
    if (member?.slack_user_id === slackUserId) return memberKey;
  }

  const identityTokens = slackIdentityTokens(user);
  if (identityTokens.size === 0) return null;

  const members = knownMemberKeys(config, repoRoot);
  const exactMatches = members.filter((memberKey) => identityTokens.has(normalizeToken(memberKey)));
  if (exactMatches.length === 1) return exactMatches[0];

  const aliasMatches = members.filter((memberKey) => {
    const aliases = memberAliasTokens(memberKey, config?.members?.[memberKey]);
    return [...aliases].some((alias) => identityTokens.has(alias));
  });
  if (aliasMatches.length === 1) return aliasMatches[0];

  return null;
}
