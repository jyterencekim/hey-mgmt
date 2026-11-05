import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { parseArtifact, writeArtifact } from './content-io.mjs';
import { sendInboxItem } from './inbox.mjs';
import {
  ALERT_RESEND_DAYS,
  DROPPED_STATUSES,
  OPEN_STATUSES,
  buildInitiativeMembership,
  dateOnly,
  daysBetween,
  isActiveProduct,
  isEmpty,
  kickoffIsEnforced,
  missingKickoffFields,
  scopeChanges,
  taskGaps,
} from './product-initiative-rules.mjs';

export * from './product-initiative-rules.mjs';

// decision_adr-product-initiative-kickoff: report, kickoff and alert commands
// over the rules in product-initiative-rules.mjs.

/** Group member tasks by component (D3), for weekly rendering. */
function componentRollup(initiative, tasks) {
  const order = [...initiative.components];
  const groups = new Map(order.map((name) => [name, []]));
  for (const task of tasks) {
    const key = task.component && groups.has(task.component) ? task.component : '(no component)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      id: task.id,
      title: task.title,
      status: task.status,
      owner: task.owner ?? null,
      start_date: task.start_date ?? null,
      target_date: task.target_date ?? null,
    });
  }
  return [...groups.entries()].map(([component, items]) => ({
    component,
    total: items.length,
    done: items.filter((item) => item.status === 'done').length,
    tasks: items,
  }));
}

/**
 * One report over every initiative: kind coverage, and for active product
 * initiatives the kickoff gaps, task gaps, slips, scope diff and component
 * rollup. Read-only.
 */
export function evaluateProductInitiatives(entries, options = {}) {
  const today = dateOnly(options.today) ?? new Date().toISOString().slice(0, 10);
  const member = options.member ?? null;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const membership = buildInitiativeMembership(entries);
  const initiatives = entries.filter((entry) => entry.type === 'initiative');

  const unclassified = initiatives
    .filter((entry) => entry.status === 'active' && isEmpty(entry.initiative_kind))
    .filter((entry) => !member || entry.owner === member)
    .map((entry) => ({ id: entry.id, title: entry.title, owner: entry.owner ?? null }));

  const products = [];
  for (const initiative of initiatives) {
    if (!isActiveProduct(initiative)) continue;
    if (member && initiative.owner !== member) continue;
    const memberIds = membership.get(initiative.id) ?? new Set();
    const tasks = [...memberIds].map((id) => byId.get(id)).filter(Boolean);
    const openTasks = tasks.filter((task) => OPEN_STATUSES.has(task.status));

    const taskIssues = [];
    for (const task of openTasks) {
      const gaps = taskGaps(task, initiative, today);
      if (gaps.length > 0) {
        taskIssues.push({ id: task.id, title: task.title, owner: task.owner ?? null, status: task.status, gaps });
      }
    }

    const missing = missingKickoffFields(initiative);
    const scope = scopeChanges(initiative, memberIds, byId);
    const liveTasks = tasks.filter((task) => !DROPPED_STATUSES.has(task.status));
    products.push({
      id: initiative.id,
      title: initiative.title,
      owner: initiative.owner ?? null,
      prd_doc: initiative.prd_doc ?? null,
      timeline_start: initiative.timeline_start ?? null,
      timeline_end: initiative.timeline_end ?? null,
      timeline_passed: Boolean(initiative.timeline_end && initiative.timeline_end < today),
      kickoff_date: initiative.kickoff_date ?? null,
      enforced: kickoffIsEnforced(initiative),
      missing_kickoff: missing,
      task_gaps: taskIssues,
      scope,
      components: componentRollup(initiative, liveTasks),
      red_flag_count: missing.length + taskIssues.reduce((sum, task) => sum + task.gaps.length, 0),
    });
  }

  return {
    today,
    member,
    unclassified,
    products,
    counts: {
      unclassified: unclassified.length,
      active_products: products.length,
      products_with_gaps: products.filter((product) => product.red_flag_count > 0).length,
      scope_changes: products.filter((product) => product.scope && (product.scope.added.length + product.scope.removed.length) > 0).length,
    },
  };
}

export function buildProductInitiativeReport(repoRoot, options = {}) {
  return evaluateProductInitiatives(loadManifest(repoRoot), options);
}

export function formatProductInitiativeReport(report) {
  const lines = ['', `Product initiative check${report.member ? ` for ${report.member}` : ''} (${report.today})`, ''];
  if (report.unclassified.length > 0) {
    lines.push(`Active initiatives without x_initiative_kind (${report.unclassified.length})`);
    for (const entry of report.unclassified) lines.push(`  - ${entry.title} (${entry.id}${entry.owner ? `, ${entry.owner}` : ''})`);
    lines.push('');
  }
  if (report.products.length === 0) {
    lines.push('No active product initiatives.');
    return lines.join('\n');
  }
  for (const product of report.products) {
    const flag = product.red_flag_count > 0 ? '🔴' : '🟢';
    const span = `${product.timeline_start ?? '?'} → ${product.timeline_end ?? '?'}`;
    lines.push(`${flag} ${product.title} (${product.id}${product.owner ? `, ${product.owner}` : ''}) ${span}`);
    for (const gap of product.missing_kickoff) {
      lines.push(`    missing ${gap.label} (${gap.field})${product.enforced ? '' : ' — backfill'}`);
    }
    for (const task of product.task_gaps) {
      lines.push(`    task ${task.title} (${task.id}): ${task.gaps.map((gap) => gap.label).join(', ')}`);
    }
    if (product.scope) {
      for (const task of product.scope.added) lines.push(`    scope + ${task.title} (${task.id})`);
      for (const task of product.scope.removed) lines.push(`    scope − ${task.title ?? task.id} (${task.id}, ${task.reason})`);
    }
  }
  return lines.join('\n');
}

// ── Kickoff (D2/D5) ─────────────────────────────────────────────────────────

/**
 * Freeze an initiative's plan: record x_kickoff_date and x_baseline_tasks from
 * the current non-dropped member tasks, and move a `plan` initiative to
 * `active`. Refuses when the other kickoff fields are missing.
 */
export function kickoffInitiative(repoRoot, initiativeId, options = {}) {
  const root = resolve(repoRoot);
  const manifest = loadManifest(root);
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  const entry = byId.get(initiativeId);
  if (!entry || entry.type !== 'initiative') throw new Error(`Initiative not found: ${initiativeId}`);
  if (entry.initiative_kind !== 'product') {
    throw new Error(`${initiativeId} is not a product initiative (x_initiative_kind: ${entry.initiative_kind ?? 'unset'})`);
  }

  const date = dateOnly(options.date) ?? new Date().toISOString().slice(0, 10);
  const prerequisite = missingKickoffFields({ ...entry, kickoff_date: date, baseline_tasks: ['pending'] });
  if (prerequisite.length > 0) {
    throw new Error(`Cannot kick off ${initiativeId}: missing ${prerequisite.map((gap) => gap.field).join(', ')}`);
  }

  const memberIds = buildInitiativeMembership(manifest).get(initiativeId) ?? new Set();
  const baseline = [...memberIds]
    .filter((id) => !DROPPED_STATUSES.has(byId.get(id)?.status))
    .sort();
  if (baseline.length === 0) throw new Error(`Cannot kick off ${initiativeId}: no linked tasks to baseline`);

  const filePath = resolve(root, entry.path);
  const artifact = parseArtifact(filePath, resolve(root, 'content'));
  const frontmatter = {
    ...artifact.frontmatter,
    status: artifact.frontmatter.status === 'plan' ? 'active' : artifact.frontmatter.status,
    x_kickoff_date: date,
    x_baseline_tasks: baseline,
    updated_at: dateOnly(options.today) ?? new Date().toISOString().slice(0, 10),
  };
  if (!options.dryRun) writeArtifact(filePath, frontmatter, artifact.body);
  return { id: initiativeId, path: entry.path, kickoff_date: date, baseline_tasks: baseline, status: frontmatter.status, dry_run: Boolean(options.dryRun) };
}

// ── Alerts (D6) ─────────────────────────────────────────────────────────────

/**
 * One key per missing item, so reminders dedupe by initiative/task, missing
 * field and recipient rather than by the whole gap set.
 */
export function gapKeys(product) {
  return [
    ...product.missing_kickoff.map((gap) => ({ key: `${product.id}:${gap.field}`, scope: 'initiative', gap })),
    ...product.task_gaps.flatMap((task) => task.gaps.map((gap) => ({
      key: `${task.id}:${gap.field}:${gap.slipped ? 'slip' : 'missing'}`,
      scope: 'task',
      task,
      gap,
    }))),
  ];
}

function priorAlerts(repoRoot, owner) {
  const inboxRoot = resolve(repoRoot, 'workspace', owner, 'inbox');
  if (!existsSync(inboxRoot)) return [];
  const items = [];
  for (const status of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!status.isDirectory()) continue;
    const dir = resolve(inboxRoot, status.name);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const item = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
        if (item?.metadata?.x_product_gap_initiative) items.push(item);
      } catch {
        // Unreadable inbox file: skip; it cannot suppress an alert.
      }
    }
  }
  return items;
}

/** Keys already reminded to this recipient within ALERT_RESEND_DAYS. */
function recentlyRemindedKeys(repoRoot, owner, initiativeId, today) {
  const keys = new Set();
  for (const item of priorAlerts(repoRoot, owner)) {
    if (item.metadata.x_product_gap_initiative !== initiativeId) continue;
    const sent = dateOnly(item.metadata.x_sent_at ?? item.captured_at);
    const age = sent ? daysBetween(sent, today) : null;
    if (age === null || age >= ALERT_RESEND_DAYS) continue;
    for (const key of item.metadata.x_gap_keys ?? []) keys.add(key);
  }
  return keys;
}

function alertBody(product, entries, remainingCount) {
  const lines = [
    `Product initiative **${product.title}** (\`${product.id}\`) is missing items required by decision_adr-product-initiative-kickoff.`,
    '',
  ];
  const initiativeGaps = entries.filter((entry) => entry.scope === 'initiative');
  if (initiativeGaps.length > 0) {
    lines.push('Initiative fields to fill:');
    for (const { gap } of initiativeGaps) lines.push(`- ${gap.label} (\`${gap.field}\`)`);
    lines.push('');
  }
  const byTask = new Map();
  for (const entry of entries.filter((item) => item.scope === 'task')) {
    if (!byTask.has(entry.task.id)) byTask.set(entry.task.id, { task: entry.task, gaps: [] });
    byTask.get(entry.task.id).gaps.push(entry.gap);
  }
  if (byTask.size > 0) {
    lines.push('Tasks to fix:');
    for (const { task, gaps } of byTask.values()) {
      lines.push(`- ${task.title} (\`${task.id}\`): ${gaps.map((gap) => gap.label).join(', ')}`);
    }
    lines.push('');
  }
  if (remainingCount > 0) {
    lines.push(`${remainingCount} other gap(s) on this initiative were reminded within the last ${ALERT_RESEND_DAYS} days and are still open; \`./hey initiative check --member ${product.owner}\` lists them.`);
    lines.push('');
  }
  lines.push('After filling the PRD, dates and component tasks, freeze the plan with `./hey initiative kickoff <id>`.');
  return lines.join('\n');
}

/**
 * Send one inbox item per active product initiative to its owner, listing only
 * the gaps not already reminded to that owner within ALERT_RESEND_DAYS.
 * Fisher's member-inbox Slack job delivers the item; this command records the
 * inbox item only, never Slack delivery.
 */
export function sendProductGapAlerts(repoRoot, options = {}) {
  const root = resolve(repoRoot);
  const report = buildProductInitiativeReport(root, { today: options.today, member: options.member });
  const from = options.from ?? 'fisher';
  const results = [];
  for (const product of report.products) {
    if (product.red_flag_count === 0) continue;
    if (!product.owner) {
      results.push({ id: product.id, action: 'skipped', reason: 'no owner' });
      continue;
    }
    const entries = gapKeys(product);
    const reminded = recentlyRemindedKeys(root, product.owner, product.id, report.today);
    const fresh = entries.filter((entry) => !reminded.has(entry.key));
    if (fresh.length === 0) {
      results.push({ id: product.id, owner: product.owner, action: 'skipped', reason: `all ${entries.length} gap(s) reminded within ${ALERT_RESEND_DAYS} days` });
      continue;
    }
    if (options.dryRun) {
      results.push({ id: product.id, owner: product.owner, action: 'would_send', gaps: fresh.length });
      continue;
    }
    const { item } = sendInboxItem({
      repoRoot: root,
      from,
      to: product.owner,
      title: `Product initiative gaps: ${product.title}`,
      body: alertBody(product, fresh, entries.length - fresh.length),
      metadata: {
        x_product_gap_initiative: product.id,
        x_gap_keys: fresh.map((entry) => entry.key),
        x_gap_count: fresh.length,
      },
    });
    results.push({ id: product.id, owner: product.owner, action: 'sent', inbox_id: item.id, gaps: fresh.length });
  }
  return { today: report.today, dry_run: Boolean(options.dryRun), results };
}
