import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { generateUlid, scaffoldArtifact } from './scaffold.mjs';
import { parseArtifact, readArtifactsWithErrors, writeArtifact } from './content-io.mjs';

export const INBOX_STATUSES = ['open', 'read', 'promoted', 'discarded'];

function inboxRoot(repoRoot, workspace) {
  return resolve(repoRoot, 'workspace', workspace, 'inbox');
}

function inboxDir(repoRoot, workspace, status = null) {
  return status
    ? resolve(inboxRoot(repoRoot, workspace), status)
    : inboxRoot(repoRoot, workspace);
}

function inboxPath(repoRoot, workspace, itemId, status = 'open') {
  return resolve(inboxDir(repoRoot, workspace, status), `${itemId}.json`);
}

function legacyInboxPath(repoRoot, workspace, itemId) {
  return resolve(inboxRoot(repoRoot, workspace), `${itemId}.json`);
}

function readItem(path) {
  const item = JSON.parse(readFileSync(path, 'utf8'));
  if (!item.status) {
    item.status = 'open';
  }
  return item;
}

function writeItem(path, item) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`, 'utf8');
}

function assertInboxStatus(status) {
  if (!INBOX_STATUSES.includes(status)) {
    throw new Error(`Unknown inbox status "${status}". Valid statuses: ${INBOX_STATUSES.join(', ')}`);
  }
}

function findInboxItemPath({ repoRoot, workspace, itemId }) {
  const preferredPaths = [
    ...INBOX_STATUSES.map((status) => inboxPath(repoRoot, workspace, itemId, status)),
    legacyInboxPath(repoRoot, workspace, itemId),
  ];
  return preferredPaths.find((path) => existsSync(path)) ?? null;
}

function getInboxItemRecord({ repoRoot, workspace, itemId }) {
  const path = findInboxItemPath({ repoRoot, workspace, itemId });
  if (!path) {
    throw new Error(`Inbox item not found: ${itemId}`);
  }
  return { path, item: readItem(path) };
}

function moveInboxItem({ repoRoot, workspace, item, fromPath, toStatus }) {
  assertInboxStatus(toStatus);
  const targetPath = inboxPath(repoRoot, workspace, item.id, toStatus);
  if (fromPath !== targetPath) {
    mkdirSync(dirname(targetPath), { recursive: true });
    renameSync(fromPath, targetPath);
  }
  return targetPath;
}

function listJsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => resolve(dir, entry.name));
}

function collectInboxPaths({ repoRoot, workspace, statuses }) {
  const pathsById = new Map();

  for (const status of statuses) {
    for (const path of listJsonFiles(inboxDir(repoRoot, workspace, status))) {
      const itemId = basename(path, '.json');
      pathsById.set(itemId, path);
    }
  }

  for (const path of listJsonFiles(inboxRoot(repoRoot, workspace))) {
    const itemId = basename(path, '.json');
    if (itemId.startsWith('inbox_') && !pathsById.has(itemId)) {
      pathsById.set(itemId, path);
    }
  }

  return [...pathsById.values()];
}

function loadMemberNames(repoRoot) {
  const membersPath = resolve(repoRoot, 'content', 'vocab', 'members.yml');
  if (!existsSync(membersPath)) return [];
  const parsed = parseYaml(readFileSync(membersPath, 'utf8'));
  return (parsed?.members ?? []).map((m) => m.name);
}

function taskRefForItem(item) {
  const ref = item?.metadata?.x_task_ref;
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null;
}

function loadTaskLookup(repoRoot) {
  const contentRoot = resolve(repoRoot, 'content');
  if (!existsSync(contentRoot)) return new Map();

  const tasks = new Map();
  const { artifacts } = readArtifactsWithErrors(contentRoot);
  for (const artifact of artifacts) {
    if (artifact.type !== 'task' || !artifact.id) continue;
    tasks.set(artifact.id, artifact);
  }
  return tasks;
}

function taskSummary(task) {
  return {
    id: task.id,
    title: task.title,
    status: task.frontmatter.status ?? null,
    owner: task.frontmatter.owner ?? null,
    updated_at: task.frontmatter.updated_at ?? null,
    path: task.relativePath,
  };
}

function annotateLinkedTask(item, taskLookup) {
  const taskRef = taskRefForItem(item);
  if (!taskRef) return item;

  const task = taskLookup.get(taskRef);
  if (!task) {
    return {
      ...item,
      linked_task: { id: taskRef, status: 'missing' },
      stale_reason: `linked task ${taskRef} was not found`,
    };
  }

  const linkedTask = taskSummary(task);
  const terminalStatuses = new Set(['done', 'archived']);
  return {
    ...item,
    linked_task: linkedTask,
    ...(terminalStatuses.has(String(linkedTask.status))
      ? { stale_reason: `linked task ${taskRef} is ${linkedTask.status}` }
      : {}),
  };
}

export function captureInboxItem({ repoRoot, workspace, title, body, source = null, kind = 'self', metadata = {} }) {
  const id = `inbox_${generateUlid().toLowerCase()}`;
  const item = {
    id,
    workspace,
    title,
    body,
    source,
    kind,
    status: 'open',
    captured_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata,
  };

  const path = inboxPath(repoRoot, workspace, id, 'open');
  writeItem(path, item);
  return { item, path };
}

export function sendInboxItem({ repoRoot, from, to, title, body = '', taskRef = null, metadata = {} }) {
  if (to === '@all') {
    return broadcastInboxItem({ repoRoot, from, title, body, taskRef, metadata });
  }

  const members = loadMemberNames(repoRoot);
  if (!members.includes(to)) {
    throw new Error(`Unknown member: "${to}". Valid members: ${members.join(', ')}`);
  }
  const workspaceDir = resolve(repoRoot, 'workspace', to);
  if (!existsSync(workspaceDir)) {
    throw new Error(`Member "${to}" has no workspace directory. Cannot deliver inbox item.`);
  }

  return captureInboxItem({
    repoRoot,
    workspace: to,
    title,
    body,
    source: `member:${from}`,
    kind: 'member-send',
    metadata: {
      ...metadata,
      x_from: from,
      x_sent_at: new Date().toISOString(),
      ...(taskRef ? { x_task_ref: taskRef } : {}),
    },
  });
}

export function broadcastInboxItem({ repoRoot, from, title, body = '', taskRef = null, metadata = {} }) {
  const members = loadMemberNames(repoRoot);
  const broadcastId = generateUlid().toLowerCase();
  const results = [];

  for (const member of members) {
    if (member === from) continue;
    const workspaceDir = resolve(repoRoot, 'workspace', member);
    if (!existsSync(workspaceDir)) continue;

    const result = captureInboxItem({
      repoRoot,
      workspace: member,
      title,
      body,
      source: `member:${from}`,
      kind: 'broadcast',
      metadata: {
        ...metadata,
        x_from: from,
        x_sent_at: new Date().toISOString(),
        x_broadcast_id: broadcastId,
        ...(taskRef ? { x_task_ref: taskRef } : {}),
      },
    });
    results.push(result);
  }

  return { broadcastId, results };
}

export function replyToInboxItem({ repoRoot, workspace, itemId, body, title = null }) {
  const { item } = getInboxItemRecord({ repoRoot, workspace, itemId });
  const recipient =
    (item.metadata && typeof item.metadata.x_from === 'string' && item.metadata.x_from) ||
    (typeof item.source === 'string' && item.source.startsWith('member:')
      ? item.source.slice('member:'.length)
      : null);
  if (!recipient) {
    throw new Error(`Cannot determine reply recipient for item "${itemId}" (no x_from in metadata and source is not "member:*").`);
  }
  const replyTitle = title && title.trim() ? title : `Re: ${item.title}`;
  const sent = sendInboxItem({
    repoRoot,
    from: workspace,
    to: recipient,
    title: replyTitle,
    body,
    metadata: { x_reply_to: itemId },
  });

  // Auto-ack the original if still open; swallow if already acked/discarded.
  if (item.status === 'open') {
    try {
      acknowledgeInboxItem({
        repoRoot,
        workspace,
        itemId,
        context: { command: 'inbox reply', note: `Replied to ${recipient}` },
      });
    } catch {
      // Race or pre-existing state change — not fatal for reply delivery.
    }
  }

  return { sent, recipient };
}

export function acknowledgeInboxItem({ repoRoot, workspace, itemId, context = {} }) {
  const { path, item } = getInboxItemRecord({ repoRoot, workspace, itemId });
  if (item.status === 'read') {
    // Idempotent: item already acknowledged (e.g. moved to read/ on board view).
    // Refresh ack metadata so a re-ack with a new note still records the note.
    item.acknowledged_at = new Date().toISOString();
    item.acknowledged_by = workspace;
    item.acknowledged_via = {
      command: context.command ?? 'inbox ack',
      ...(context.note ? { note: context.note } : {}),
      ...context,
    };
    item.updated_at = new Date().toISOString();
    writeItem(path, item);
    return item;
  }
  if (item.status !== 'open') {
    throw new Error(`Cannot acknowledge item with status "${item.status}" (expected "open" or "read")`);
  }
  item.status = 'read';
  item.acknowledged_at = new Date().toISOString();
  item.acknowledged_by = workspace;
  item.acknowledged_via = {
    command: context.command ?? 'inbox ack',
    ...(context.note ? { note: context.note } : {}),
    ...context,
  };
  item.updated_at = new Date().toISOString();
  const targetPath = moveInboxItem({ repoRoot, workspace, item, fromPath: path, toStatus: item.status });
  writeItem(targetPath, item);
  return item;
}

export function listInboxItems({
  repoRoot,
  workspace,
  status = null,
  includeAll = false,
  includeClosed = false,
  includeRead = false,
  includeTaskStatus = true,
}) {
  if (status) {
    assertInboxStatus(status);
  }

  const statuses = status
    ? [status]
    : (includeAll || includeClosed || includeRead)
      ? INBOX_STATUSES
      : ['open'];

  const items = collectInboxPaths({ repoRoot, workspace, statuses })
    .map((path) => readItem(path))
    .filter((item) => statuses.includes(item.status))
    .sort((a, b) => (b.captured_at || '').localeCompare(a.captured_at || ''));

  if (!includeTaskStatus || !items.some((item) => taskRefForItem(item))) {
    return items;
  }

  const taskLookup = loadTaskLookup(repoRoot);
  return items.map((item) => annotateLinkedTask(item, taskLookup));
}

export function getInboxItem({ repoRoot, workspace, itemId }) {
  return getInboxItemRecord({ repoRoot, workspace, itemId }).item;
}

function artifactRoot(repoRoot, workspace = null) {
  return workspace
    ? resolve(repoRoot, 'workspace', workspace)
    : resolve(repoRoot, 'content');
}

function assertInboxActionable(item, action) {
  if (!['open', 'read'].includes(item.status)) {
    throw new Error(`Cannot ${action} item with status "${item.status}"`);
  }
}

function promoteBody(item, artifactTitle) {
  const blocks = [
    '## Context',
    `Promoted from inbox item "${item.title}"${artifactTitle && artifactTitle !== item.title ? ` into "${artifactTitle}".` : '.'}`,
    '',
    '## Raw Input',
    item.body ? String(item.body).trim() : '_No body provided._',
  ];
  if (item.source) {
    blocks.push('', '## Source', String(item.source));
  }
  return `${blocks.join('\n')}\n`;
}

export function promoteInboxItem({
  repoRoot,
  workspace,
  itemId,
  type,
  title,
  extraFields = {},
  targetWorkspace = null,
}) {
  const { path: itemPath, item } = getInboxItemRecord({ repoRoot, workspace, itemId });
  assertInboxActionable(item, 'promote');

  const resolvedTitle = title ?? item.title;
  if (!resolvedTitle) {
    throw new Error(`Cannot promote inbox item ${itemId}: no title provided and item has no title`);
  }

  const scaffolded = scaffoldArtifact({
    repoRoot,
    type,
    title: resolvedTitle,
    extraFields,
    workspace: targetWorkspace ?? undefined,
  });
  const root = artifactRoot(repoRoot, targetWorkspace);
  const artifact = parseArtifact(scaffolded.path, root);
  const frontmatter = {
    ...artifact.frontmatter,
    ...extraFields,
    x_inbox_item_id: item.id,
    x_inbox_workspace: workspace,
    x_inbox_kind: item.kind ?? 'self',
    ...(item.source ? { x_inbox_source: item.source } : {}),
  };
  writeArtifact(artifact.filePath, frontmatter, promoteBody(item, resolvedTitle));

  const updatedItem = {
    ...item,
    status: 'promoted',
    promoted_at: new Date().toISOString(),
    promoted_to: {
      id: artifact.id,
      path: scaffolded.relativePath,
      type,
      ...(targetWorkspace ? { workspace: targetWorkspace } : {}),
    },
    updated_at: new Date().toISOString(),
  };
  const targetPath = moveInboxItem({ repoRoot, workspace, item: updatedItem, fromPath: itemPath, toStatus: updatedItem.status });
  writeItem(targetPath, updatedItem);

  return {
    item: updatedItem,
    artifact: {
      id: artifact.id,
      path: scaffolded.relativePath,
      type,
    },
  };
}

export function discardInboxItem({ repoRoot, workspace, itemId, reason = null }) {
  const { path: itemPath, item } = getInboxItemRecord({ repoRoot, workspace, itemId });
  assertInboxActionable(item, 'discard');

  const updatedItem = {
    ...item,
    status: 'discarded',
    discarded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(reason ? { discard_reason: reason } : {}),
  };
  const targetPath = moveInboxItem({ repoRoot, workspace, item: updatedItem, fromPath: itemPath, toStatus: updatedItem.status });
  writeItem(targetPath, updatedItem);
  return updatedItem;
}
