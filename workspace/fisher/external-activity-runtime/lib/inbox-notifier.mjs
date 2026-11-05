import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function listOpenItems(repoRoot, member) {
  const dir = resolve(repoRoot, 'workspace', member, 'inbox', 'open');
  if (!existsSync(dir)) return [];

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    // A local acknowledgement can coexist with a stale open/ copy after sync.
    .filter((entry) => !existsSync(resolve(repoRoot, 'workspace', member, 'inbox', 'read', entry.name)))
    .map((entry) => JSON.parse(readFileSync(resolve(dir, entry.name), 'utf8')))
    .sort((a, b) => (b.captured_at ?? '').localeCompare(a.captured_at ?? ''));
}

export class InboxNotifier {
  static DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

  constructor({
    repoRoot,
    config,
    webClient = null,
    nodeBin = process.env.hey-mgmt_CONNECTOR_NODE || process.execPath,
  }) {
    this.repoRoot = repoRoot;
    this.config = config;
    this.webClient = webClient;
    this.nodeBin = nodeBin;
    this.notifyStatePath = resolve(repoRoot, '.runtime', 'inbox-notify-state.json');
    this.sessionStatePath = resolve(repoRoot, '.runtime', 'inbox-dm-sessions.json');
  }

  get sessionTtlMs() {
    const minutes = Number(this.config?.inbox?.session_ttl_minutes);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * 60 * 1000;
    return InboxNotifier.DEFAULT_SESSION_TTL_MS;
  }

  readState() {
    return readJson(this.notifyStatePath, {});
  }

  writeState(state) {
    writeJson(this.notifyStatePath, state);
  }

  readSessions() {
    return readJson(this.sessionStatePath, {});
  }

  writeSessions(sessions) {
    writeJson(this.sessionStatePath, sessions);
  }

  membersWithSlack() {
    return Object.entries(this.config?.members ?? {})
      .filter(([, member]) => member?.slack_dm_id || member?.slack_user_id)
      .map(([memberKey]) => memberKey);
  }

  getOpenItems(member) {
    return listOpenItems(this.repoRoot, member);
  }

  getUnnotifiedItems(member) {
    const state = this.readState();
    const notified = state[member] ?? {};
    return this.getOpenItems(member).filter((item) => !notified[item.id]);
  }

  markNotified(member, itemId, notifiedAt = new Date().toISOString()) {
    const state = this.readState();
    if (!state[member]) state[member] = {};
    state[member][itemId] = notifiedAt;
    this.writeState(state);
  }

  pruneState() {
    // Inbox IDs are unique. Retain delivery history so a stale open/ copy
    // cannot be delivered again after an acknowledgement.
  }

  formatSourceLabel(item) {
    if (item.kind === 'broadcast') return 'broadcast';
    if (item.metadata?.x_from) return item.metadata.x_from;
    if (typeof item.source === 'string' && item.source.startsWith('member:')) {
      return item.source.slice('member:'.length);
    }
    return item.source ?? 'unknown';
  }

  formatTimestamp(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '-';

    return new Intl.DateTimeFormat('en-US', {
      timeZone: this.config?.digest?.timezone ?? 'Asia/Seoul',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  }

  currentDigestLabel() {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.config?.digest?.timezone ?? 'Asia/Seoul',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  formatItemBlocks(item) {
    const from = this.formatSourceLabel(item);
    const capturedAt = this.formatTimestamp(item.captured_at);
    const title = item.title ?? '(no title)';
    const body = item.body ? String(item.body).slice(0, 1500) : '_No body provided._';

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `📬 *New inbox item from ${from}*` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${title}*\n\n${body}` },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `*Source:* ${item.source ?? '-'} · *Captured:* ${capturedAt}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Reply with a number to see details, or: '
            + `\`ack ${item.id}\` · \`discard ${item.id}\``,
        },
      },
    ];
  }

  interactiveActionValue(member, itemId, action) {
    return JSON.stringify({ version: 1, member, item_id: itemId, action });
  }

  formatChannelDigestBlocks(member, items) {
    const slackUserId = this.config?.members?.[member]?.slack_user_id;
    if (!slackUserId) return [];

    const blocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<@${slackUserId}> 📬 *새 inbox 항목 ${items.length}개가 있습니다.*`,
      },
    }];

    for (const item of items) {
      const from = this.formatSourceLabel(item);
      const capturedAt = this.formatTimestamp(item.captured_at);
      const title = item.title ?? '(제목 없음)';
      const body = item.body ? String(item.body).slice(0, 1200) : '_내용 없음_';
      blocks.push(
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*${title}*\n${body}\n_From: ${from} · ${capturedAt}_` },
        },
        {
          type: 'actions',
          block_id: `fisher_inbox_${item.id}`,
          elements: [
            {
              type: 'button',
              action_id: 'fisher_inbox_ack',
              text: { type: 'plain_text', text: 'Ack' },
              style: 'primary',
              value: this.interactiveActionValue(member, item.id, 'ack'),
            },
            {
              type: 'button',
              action_id: 'fisher_inbox_discard',
              text: { type: 'plain_text', text: 'Discard' },
              style: 'danger',
              confirm: {
                title: { type: 'plain_text', text: 'Discard inbox item?' },
                text: { type: 'mrkdwn', text: `*${title}* 항목을 discard합니다.` },
                confirm: { type: 'plain_text', text: 'Discard' },
                deny: { type: 'plain_text', text: 'Cancel' },
              },
              value: this.interactiveActionValue(member, item.id, 'discard'),
            },
          ],
        },
      );
    }
    return blocks;
  }

  get channelBatchSize() {
    const configured = Number(this.config?.inbox?.max_items_per_message);
    if (Number.isInteger(configured) && configured > 0) return Math.min(configured, 20);
    return 20;
  }

  formatListBlocks(items, options = {}) {
    const {
      titleText = `📬 *You have ${items.length} open inbox item${items.length === 1 ? '' : 's'}*`,
      footerText = 'Reply with a number to see details, or: `ack 1` · `discard 1`',
      emptyText = '📬 *You have no open inbox items.*',
    } = options;

    if (items.length === 0) {
      return [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: emptyText },
        },
      ];
    }

    const lines = items.map((item, index) => {
      const from = this.formatSourceLabel(item);
      const capturedAt = this.formatTimestamp(item.captured_at);
      return `*${index + 1}.* ${item.title ?? '(no title)'}\n_From: ${from} · ${capturedAt}_`;
    });

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: titleText },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n\n') },
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: footerText },
        ],
      },
    ];
  }

  async resolveDmChannel(memberKey) {
    const member = this.config?.members?.[memberKey];
    if (!member) return null;
    if (member.slack_dm_id) return member.slack_dm_id;

    if (member.slack_user_id && this.webClient?.conversations?.open) {
      const opened = await this.webClient.conversations.open({ users: member.slack_user_id });
      return opened.channel?.id ?? null;
    }

    return null;
  }

  updateSession(member, itemIds, listedAt = new Date().toISOString()) {
    const sessions = this.readSessions();
    sessions[member] = {
      items: itemIds,
      listed_at: listedAt,
    };
    this.writeSessions(sessions);
  }

  resolveItemId(member, target) {
    if (typeof target === 'string' && target.startsWith('inbox_')) return target;
    if (typeof target !== 'number') return null;

    const sessions = this.readSessions();
    const session = sessions[member];
    if (!session?.items || !session?.listed_at) return null;

    const listedAt = new Date(session.listed_at).getTime();
    if (!Number.isFinite(listedAt)) return null;
    if (Date.now() - listedAt > this.sessionTtlMs) return null;

    return session.items[target - 1] ?? null;
  }

  async pollAndNotify() {
    const deliveries = [];
    this.pruneState();

    if (!this.webClient?.chat?.postMessage) return deliveries;

    for (const member of this.membersWithSlack()) {
      const dmChannel = await this.resolveDmChannel(member);
      if (!dmChannel) continue;

      for (const item of this.getUnnotifiedItems(member)) {
        try {
          const text = `📬 New inbox item: ${item.title ?? item.id}`;
          const blocks = this.formatItemBlocks(item);
          await this.webClient.chat.postMessage({ channel: dmChannel, text, blocks });
          this.markNotified(member, item.id);
          deliveries.push({ member, itemId: item.id, mode: 'notify' });
        } catch {
          // Keep notifying other items/members even if one delivery fails.
        }
      }
    }

    return deliveries;
  }

  async pollAndNotifyChannel({ dryRun = false } = {}) {
    const deliveries = [];
    const failures = [];
    this.pruneState();
    const channel = this.config?.inbox?.channel ?? this.config?.digest?.channel;
    if (!channel) throw new Error('Missing inbox.channel or digest.channel');
    if (!dryRun && !this.webClient?.chat?.postMessage) return deliveries;

    const pending = this.membersWithSlack().map((member) => ({
      member,
      unnotifiedItems: this.getUnnotifiedItems(member),
    })).filter(({ unnotifiedItems }) => unnotifiedItems.length > 0);
    if (pending.length === 0) return deliveries;

    // One top-level post per run; member mentions and actions stay in its thread.
    const parentText = `📬 새 inbox 알림 · ${pending.length}명 (각 멤버별 내역은 스레드)`;
    let threadTs = null;
    if (!dryRun) {
      const parent = await this.webClient.chat.postMessage({ channel, text: parentText });
      threadTs = parent.ts;
      if (!threadTs) throw new Error('Inbox Slack parent message has no ts; refusing unthreaded notifications');
    }

    for (const { member, unnotifiedItems } of pending) {
      const items = unnotifiedItems.slice(0, this.channelBatchSize);
      if (items.length === 0) continue;
      const blocks = this.formatChannelDigestBlocks(member, items);
      if (unnotifiedItems.length > items.length) {
        blocks.push({
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `이번 메시지는 ${items.length}개만 표시합니다. 남은 ${unnotifiedItems.length - items.length}개는 다음 실행에서 전달됩니다.`,
          }],
        });
      }
      if (blocks.length === 0) continue;
      const text = `<@${this.config.members[member].slack_user_id}> inbox ${items.length}개`;
      if (!dryRun) {
        try {
          await this.webClient.chat.postMessage({ channel, thread_ts: threadTs, text, blocks });
          for (const item of items) this.markNotified(member, item.id);
        } catch (error) {
          failures.push({ member, error: error.message });
          continue;
        }
      }
      deliveries.push({
        member,
        itemIds: items.map((item) => item.id),
        mode: dryRun ? 'dry-run' : 'channel-notify',
        channel,
        ...(dryRun ? { text, blocks, parentText } : { threadTs }),
      });
    }
    if (failures.length > 0) {
      const error = new Error(`Inbox Slack delivery failed for ${failures.map((entry) => entry.member).join(', ')}`);
      error.failures = failures;
      error.deliveries = deliveries;
      throw error;
    }
    return deliveries;
  }

  handleInteractiveAction({ action, member, itemId, actorSlackUserId }) {
    if (!['ack', 'discard'].includes(action)) {
      return { ok: false, status: 'invalid_action', text: 'Unsupported inbox action.' };
    }
    const expectedSlackUserId = this.config?.members?.[member]?.slack_user_id;
    if (!expectedSlackUserId || actorSlackUserId !== expectedSlackUserId) {
      return { ok: false, status: 'forbidden', text: '이 inbox 항목의 소유자만 처리할 수 있습니다.' };
    }
    const item = this.getOpenItems(member).find((entry) => entry.id === itemId);
    if (!item) {
      const readPath = resolve(this.repoRoot, 'workspace', member, 'inbox', 'read', `${itemId}.json`);
      if (action !== 'ack' || !existsSync(readPath)) {
        return { ok: false, status: 'stale', text: '이미 처리되었거나 더 이상 열려 있지 않은 inbox 항목입니다.' };
      }
      // A previous Ack may have moved the item locally but failed to push.
      try {
        this._persistAcknowledgement(member, itemId);
        return { ok: true, status: 'acknowledged', text: '✅ 이미 Ack된 항목을 동기화했습니다.' };
      } catch (error) {
        return { ok: false, status: 'failed', text: `Ack는 로컬에 저장됐지만 동기화에 실패했습니다: ${error.message}` };
      }
    }
    try {
      this._execHey(['inbox', action, '--workspace', member, '--item', itemId]);
      if (action === 'ack') this._persistAcknowledgement(member, itemId);
      this.pruneState();
      return {
        ok: true,
        status: action === 'ack' ? 'acknowledged' : 'discarded',
        text: `${action === 'ack' ? '✅ Acknowledged' : '🗑️ Discarded'}: *${item.title ?? item.id}*`,
      };
    } catch (error) {
      return { ok: false, status: 'failed', text: `Inbox ${action} 처리/동기화 실패: ${error.message}` };
    }
  }

  _runGit(args, { allowUnchanged = false } = {}) {
    const result = spawnSync('git', args, {
      cwd: this.repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30_000,
    });
    if (result.error || (result.status !== 0 && !(allowUnchanged && result.status === 1))) {
      throw new Error(`git ${args[0]}: ${result.error?.message ?? ([result.stdout, result.stderr].filter(Boolean).join('\n').trim() || 'failed')}`);
    }
    return ['show', 'ls-files'].includes(args[0]) ? result.stdout : result.status;
  }

  _pullWithAckReconciliation(member, itemId) {
    const read = `workspace/${member}/inbox/read/${itemId}.json`;
    // Pull rebases from FETCH_HEAD, which another concurrent fetch can change
    // between its fetch and rebase phases. Rebase the named tracking ref instead.
    const sync = () => {
      this._runGit(['fetch', 'origin', 'main']);
      this._runGit(['rebase', '--autostash', 'origin/main']);
    };
    try {
      sync();
      return;
    } catch (error) {
      // Only reconcile the exact untracked read file named by this Git error.
      if (!/untracked working tree files would be overwritten by (?:merge|checkout)/.test(error.message)
          || !error.message.includes(read)) throw error;
    }

    const path = resolve(this.repoRoot, read);
    if (!existsSync(path) || this._runGit(['ls-files', '--cached', '--', read]).trim()) {
      throw new Error(`Ack sync blocked: ${read} is no longer an untracked local file`);
    }
    const localBytes = readFileSync(path, 'utf8');
    let local;
    let remote;
    try {
      local = JSON.parse(localBytes);
      remote = JSON.parse(this._runGit(['show', `origin/main:${read}`]));
    } catch {
      throw new Error(`Ack sync blocked: cannot compare ${read} with origin/main; local file preserved`);
    }
    const comparable = ({ acknowledged_at, updated_at, ...rest }) => rest;
    if (local?.id !== itemId || remote?.id !== itemId
        || local?.workspace !== member || remote?.workspace !== member
        || local?.status !== 'read' || remote?.status !== 'read'
        || !isDeepStrictEqual(comparable(local), comparable(remote))) {
      throw new Error(`Ack sync blocked: ${read} differs from origin/main; local file preserved`);
    }

    // The remote contains the same acknowledged item. Remove only its redundant,
    // untracked local copy so Git can materialize the remote file on retry.
    rmSync(path);
    try {
      sync();
    } catch (error) {
      if (!existsSync(path)) writeFileSync(path, localBytes, 'utf8');
      throw error;
    }
  }

  _persistAcknowledgement(member, itemId) {
    const open = `workspace/${member}/inbox/open/${itemId}.json`;
    const read = `workspace/${member}/inbox/read/${itemId}.json`;
    // Stage and commit only this pair; other agents' dirty/staged files are not ours.
    this._runGit(['add', '-A', '--', open, read]);
    if (this._runGit(['diff', '--cached', '--quiet', '--', open, read], { allowUnchanged: true }) === 1) {
      this._runGit(['commit', '--only', '-m', `inbox: acknowledge ${member} ${itemId}`, '--', open, read]);
    }
    this._pullWithAckReconciliation(member, itemId);
    this._runGit(['push', 'origin', 'main']);
  }

  async sendDigest(member) {
    const items = this.getOpenItems(member);
    if (items.length === 0) return null;
    if (!this.webClient?.chat?.postMessage) return null;

    const dmChannel = await this.resolveDmChannel(member);
    if (!dmChannel) return null;

    const digestLabel = this.currentDigestLabel();
    const titleText = digestLabel
      ? `📬 *Inbox Summary (${digestLabel} KST)*\n\nYou have ${items.length} open item${items.length === 1 ? '' : 's'}:`
      : `📬 *Inbox Summary*\n\nYou have ${items.length} open item${items.length === 1 ? '' : 's'}:`;
    const blocks = this.formatListBlocks(items, {
      titleText,
      footerText: 'Reply "inbox" for actions.',
    });
    const text = `📬 Inbox Summary — ${items.length} open item${items.length === 1 ? '' : 's'}`;

    await this.webClient.chat.postMessage({ channel: dmChannel, text, blocks });
    this.updateSession(member, items.map((item) => item.id));
    return { member, count: items.length };
  }

  async sendAllDigests() {
    const results = [];
    for (const member of this.membersWithSlack()) {
      const result = await this.sendDigest(member);
      if (result) results.push(result);
    }
    return results;
  }

  _execHey(args) {
    const heyScript = resolve(this.repoRoot, 'scripts', 'hey.mjs');
    const completed = spawnSync(this.nodeBin, [heyScript, ...args], {
      cwd: this.repoRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const payloadText = completed.stdout?.trim() || completed.stderr?.trim() || '{}';

    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      throw new Error(`Unexpected hey output: ${payloadText}`);
    }

    if (completed.status !== 0 || payload?.error) {
      throw new Error(payload?.error || `hey ${args.join(' ')} failed`);
    }

    return payload;
  }

  staleReply(member) {
    const items = this.getOpenItems(member);
    this.updateSession(member, items.map((item) => item.id));
    return {
      stale: true,
      text: 'Session expired. Here is your refreshed inbox list.',
      blocks: this.formatListBlocks(items),
    };
  }

  async handleInboxCommand(member, command) {
    if (!command?.intent) {
      return { text: 'Unknown inbox command.' };
    }

    if (command.intent === 'list') {
      const items = this.getOpenItems(member);
      this.updateSession(member, items.map((item) => item.id));
      return {
        text: `📬 ${items.length} open inbox item${items.length === 1 ? '' : 's'}`,
        blocks: this.formatListBlocks(items),
      };
    }

    if (command.intent === 'show') {
      const itemId = this.resolveItemId(member, command.target);
      if (!itemId) return this.staleReply(member);

      const item = this.getOpenItems(member).find((entry) => entry.id === itemId);
      if (!item) return { text: `Item not found: ${itemId}` };

      return {
        text: `📬 ${item.title ?? item.id}`,
        blocks: this.formatItemBlocks(item),
      };
    }

    if (command.intent === 'ack' || command.intent === 'discard') {
      const itemId = this.resolveItemId(member, command.target);
      if (!itemId) return this.staleReply(member);

      const item = this.getOpenItems(member).find((entry) => entry.id === itemId);
      const title = item?.title ?? itemId;

      const subcommand = command.intent === 'ack' ? 'ack' : 'discard';
      try {
        this._execHey(['inbox', subcommand, '--workspace', member, '--item', itemId]);
        this.pruneState();
        this.updateSession(member, this.getOpenItems(member).map((entry) => entry.id));
        const verb = command.intent === 'ack' ? 'Acknowledged' : 'Discarded';
        return { text: `✅ ${verb}: *${title}*` };
      } catch (error) {
        return { text: `Failed to ${subcommand} "${title}": ${error.message}` };
      }
    }

    return { text: 'Unknown inbox command.' };
  }
}
