#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InboxNotifier } from './lib/inbox-notifier.mjs';
import { loadEnvFile, loadExternalActivityRuntimeConfig } from './lib/config.mjs';

const repoRoot = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
const command = args[0];
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};

for (const path of [
  resolve(repoRoot, '.env'),
  resolve(repoRoot, 'workspace/fisher/external-activity-runtime/.env'),
  resolve(process.env.HERMES_HOME || resolve(homedir(), '.hermes'), '.env'),
]) {
  if (existsSync(path)) loadEnvFile(path);
}
const config = loadExternalActivityRuntimeConfig(repoRoot);

try {
  if (command === 'notify') {
    const dryRun = args.includes('--dry-run');
    if (!dryRun && !process.env.SLACK_BOT_TOKEN) throw new Error('Missing SLACK_BOT_TOKEN');
    const webClient = dryRun ? null : new (await import('@slack/web-api')).WebClient(process.env.SLACK_BOT_TOKEN);
    const notifier = new InboxNotifier({ repoRoot, config, webClient });
    const deliveries = await notifier.pollAndNotifyChannel({ dryRun });
    console.log(JSON.stringify({ deliveries, count: deliveries.length }, null, 2));
  } else if (command === 'action') {
    const notifier = new InboxNotifier({ repoRoot, config });
    const result = notifier.handleInteractiveAction({
      action: value('--action'), member: value('--member'), itemId: value('--item'), actorSlackUserId: value('--actor-slack-user-id'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = result.status === 'stale' ? 2 : 1;
  } else {
    throw new Error('Usage: inbox-slack.mjs notify [--dry-run] | action --action <ack|discard> --member <member> --item <id> --actor-slack-user-id <id>');
  }
} catch (error) {
  console.error(`Inbox Slack ${command ?? 'command'} failed: ${error.message}`);
  process.exitCode = 1;
}
