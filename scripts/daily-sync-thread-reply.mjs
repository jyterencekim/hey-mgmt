import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadRepositoryArtifacts } from './lib/repository-artifacts.mjs';
import { pickDailySyncTaskTitles } from './lib/daily-sync-thread-picker.mjs';

const repoRoot = process.cwd();
const configPath = resolve(repoRoot, 'workspace', 'fisher', 'config', 'external-activity.yml');
const envPaths = [resolve(repoRoot, '.env'), resolve(repoRoot, 'workspace', 'fisher', 'external-activity-runtime', '.env')];
for (const path of envPaths) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i <= 0) continue;
    const k = trimmed.slice(0, i).trim();
    const v = trimmed.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
if (!process.env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
const config = parseYaml(readFileSync(configPath, 'utf8')) || {};
const members = Object.entries(config.members || {});
const statePath = resolve(repoRoot, '.runtime', 'daily-sync-thread-replies.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const channel = 'C0AC9CBPPJS';
const headers = { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' };
async function slack(method, payload) {
  const res = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
}
function normalizeText(text) { return String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
const { artifacts } = loadRepositoryArtifacts(repoRoot);
const history = await slack('conversations.history', { channel, limit: 50 });
const target = (history.messages || []).find((m) => {
  const text = normalizeText(m.text);
  return /daily\s*sync/i.test(text) && (!m.thread_ts || m.thread_ts === m.ts);
});
if (!target) {
  console.log(JSON.stringify({ ok: true, date, posted: 0, skipped: 'no_daily_sync_message_found' }, null, 2));
  process.exit(0);
}
const threadTs = target.thread_ts || target.ts;
const threadKey = `${date}:${threadTs}`;
if (state[threadKey]?.done) {
  console.log(JSON.stringify({ ok: true, date, posted: 0, skipped: 'already_posted', thread_ts: threadTs }, null, 2));
  process.exit(0);
}
const existingTexts = new Set();
const posted = [];
for (const [memberKey, member] of members) {
  const bullets = pickDailySyncTaskTitles({ artifacts, member: memberKey, today: date, limit: 3 });
  const mention = member.slack_user_id ? `<@${member.slack_user_id}>` : `*${memberKey}*`;
  const lines = bullets.length ? bullets.map((b) => `• ${b}`) : ['• 오늘 우선순위 task 정리 필요'];
  const text = `${mention}\n${lines.join('\n')}`;
  if (existingTexts.has(normalizeText(text))) continue;
  const res = await slack('chat.postMessage', { channel, thread_ts: threadTs, text });
  posted.push({ member: memberKey, ts: res.ts });
}
state[threadKey] = { done: true, channel, thread_ts: threadTs, date, posted_members: posted.map((p) => p.member), updated_at: new Date().toISOString() };
mkdirSync(dirname(statePath), { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, date, thread_ts: threadTs, posted: posted.length, members: posted.map((p) => p.member) }, null, 2));
