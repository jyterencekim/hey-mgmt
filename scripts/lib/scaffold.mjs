import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateUlid() {
  const now = Date.now();

  // 10-char timestamp (48-bit milliseconds in base32)
  let ts = now;
  let timeStr = '';
  for (let i = 9; i >= 0; i--) {
    timeStr = CROCKFORD[ts % 32] + timeStr;
    ts = Math.floor(ts / 32);
  }

  // 16-char randomness (80 bits from crypto.randomBytes)
  const rndBytes = randomBytes(10); // 10 bytes = 80 bits
  let randStr = '';
  // Convert 80 bits to 16 base32 chars (each char = 5 bits)
  // Pack 10 bytes into a BigInt and extract 16 x 5-bit groups
  let val = BigInt(0);
  for (const byte of rndBytes) {
    val = (val << BigInt(8)) | BigInt(byte);
  }
  for (let i = 15; i >= 0; i--) {
    randStr = CROCKFORD[Number(val & BigInt(31))] + randStr;
    val >>= BigInt(5);
  }

  return timeStr + randStr;
}

export function generateArtifactId(prefix, title) {
  const slug = slugify(title).slice(0, 30).replace(/-$/, '');
  return `${prefix}_${slug}`;
}

export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
}


function yamlScalar(value) {
  const str = String(value);
  if (str.includes('\n')) {
    // Multi-line: use YAML block scalar
    const indented = str.split('\n').map(line => `  ${line}`).join('\n');
    return `|\n${indented}`;
  }
  if (/[:#"'{}\[\],&*?|>!%@`]/.test(str) || str !== str.trim() || str === '') {
    // Contains special YAML chars or leading/trailing whitespace: quote it
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

export function scaffoldTaskFile({
  repoRoot,
  title,
  project,
  owner,
  priority,
  status,
  definitionOfDone = [],
  dueDate,
  iteration,
}) {
  const id = generateArtifactId('task', title);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;

  const filename = `${id}.md`;

  const dirRelative = join('content', 'tasks', String(yyyy), mm);
  const dirAbsolute = join(repoRoot, dirRelative);
  mkdirSync(dirAbsolute, { recursive: true });

  const filePath = join(dirAbsolute, filename);
  const relativePath = join(dirRelative, filename);

  // Build frontmatter
  const criteriaLines = definitionOfDone.map(c => `  - ${yamlScalar(c)}`).join('\n');
  const criteriaBlock = criteriaLines ? `\n${criteriaLines}` : '';

  let frontmatter = `---
id: ${id}
type: task
title: ${yamlScalar(title)}
created_at: ${today}
updated_at: ${today}
status: ${status}
owner: ${yamlScalar(owner)}`;

  if (project) frontmatter += `\narea: ${project}`;
  if (priority) frontmatter += `\npriority: ${priority}`;
  if (dueDate != null) frontmatter += `\ndue_date: ${dueDate}`;
  if (iteration) frontmatter += `\niteration: ${yamlScalar(iteration)}`;

  frontmatter += `\ndefinition_of_done:${criteriaBlock}
---`;

  // Build body
  const checklistLines = definitionOfDone.map(c => `- [ ] ${c}`).join('\n');

  const body = `
## Context
<!-- Why does this task exist? -->
<!-- Optional mission overrides: x_evaluation, x_required_evidence, x_escalation, x_runtime_targets. Leave unset unless the generated mission needs correction. -->

## Definition of Done
${checklistLines}`;

  writeFileSync(filePath, frontmatter + '\n' + body + '\n', 'utf8');

  return {
    id,
    path: filePath,
    relativePath,
  };
}

export const TYPE_CONFIG = {
  task: { prefix: 'task', dir: 'tasks', requiredExtra: ['definition_of_done'] },
  decision: { prefix: 'decision', dir: 'decisions', requiredExtra: ['decision_status', 'owners'] },
  meeting: { prefix: 'meeting', dir: 'meetings', requiredExtra: ['attendees', 'start_at', 'end_at'] },
  playbook: { prefix: 'playbook', dir: 'playbooks', requiredExtra: ['playbook_version'] },
  note: { prefix: 'note', dir: 'notes', requiredExtra: [] },
  initiative: { prefix: 'initiative', dir: 'initiatives', requiredExtra: ['definition_of_done'] },
  goal: { prefix: 'goal', dir: 'goals', requiredExtra: [] },
};

export function scaffoldArtifact({
  repoRoot,
  type,
  title,
  extraFields = {},
  workspace,
  domain,
}) {
  const config = TYPE_CONFIG[type];
  if (!config) {
    throw new Error(`Unknown artifact type: ${type}. Valid: ${Object.keys(TYPE_CONFIG).join(', ')}`);
  }

  const id = generateArtifactId(config.prefix, title);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;

  // Dated subdirectory for tasks, meetings, notes; flat for others
  const useDatedDir = ['tasks', 'meetings', 'notes', 'initiatives'].includes(config.dir);
  const useDomainSubfolder = domain && ['notes', 'decisions', 'playbooks'].includes(config.dir);
  let dirRelative;
  if (workspace) {
    dirRelative = join('workspace', workspace);
  } else if (useDatedDir) {
    dirRelative = useDomainSubfolder
      ? join('content', config.dir, domain, String(yyyy), mm)
      : join('content', config.dir, String(yyyy), mm);
  } else {
    dirRelative = useDomainSubfolder
      ? join('content', config.dir, domain)
      : join('content', config.dir);
  }
  const dirAbsolute = join(repoRoot, dirRelative);
  mkdirSync(dirAbsolute, { recursive: true });

  const filename = `${id}.md`;
  const filePath = join(dirAbsolute, filename);
  const relativePath = join(dirRelative, filename);

  if (workspace && !extraFields.owner) {
    extraFields.owner = workspace;
  }

  if ('project' in extraFields && !('area' in extraFields)) {
    extraFields = { ...extraFields, area: extraFields.project };
  }
  if ('project' in extraFields) {
    const { project: _legacyProject, ...rest } = extraFields;
    extraFields = rest;
  }

  if (domain) {
    const domainTag = domain.charAt(0).toUpperCase() + domain.slice(1);
    if (Array.isArray(extraFields.tags)) {
      if (!extraFields.tags.includes(domainTag)) {
        extraFields = { ...extraFields, tags: [...extraFields.tags, domainTag] };
      }
    } else {
      extraFields = { ...extraFields, tags: [domainTag] };
    }
  }

  // Ensure initiative has definition_of_done placeholder
  if (type === 'initiative' && !extraFields.definition_of_done) {
    extraFields.definition_of_done = ['TODO: define completion criteria'];
  }

  // Build frontmatter as key-value pairs
  const fm = {
    id,
    type,
    title,
    created_at: today,
    updated_at: today,
    ...extraFields,
  };

  // Serialize frontmatter to YAML manually (simple flat + arrays)
  let yamlLines = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      yamlLines.push(`${key}:`);
      for (const item of value) {
        if (typeof item === 'object') {
          const entries = Object.entries(item);
          yamlLines.push(`  - ${entries[0][0]}: ${yamlScalar(entries[0][1])}`);
          for (const [k, v] of entries.slice(1)) {
            yamlLines.push(`    ${k}: ${yamlScalar(v)}`);
          }
        } else {
          yamlLines.push(`  - ${yamlScalar(item)}`);
        }
      }
    } else if (typeof value === 'object') {
      yamlLines.push(`${key}:`);
      for (const [k, v] of Object.entries(value)) {
        if (v !== null && v !== undefined) yamlLines.push(`  ${k}: ${yamlScalar(v)}`);
      }
    } else {
      yamlLines.push(`${key}: ${yamlScalar(value)}`);
    }
  }
  yamlLines.push('---');

  // Build body
  const body = type === 'task'
    ? `\n## Context\n<!-- Describe the context for this task. -->\n<!-- Optional mission overrides: x_evaluation, x_required_evidence, x_escalation, x_runtime_targets. Leave unset unless the generated mission needs correction. -->\n`
    : type === 'initiative'
    ? fm.x_initiative_kind === 'product'
      ? `\n## Context\n<!-- Describe the context for this initiative. -->\n<!-- Product initiative kickoff contract (decision_adr-product-initiative-kickoff): before kickoff, add x_timeline_start, x_timeline_end (YYYY-MM-DD), x_prd_doc (shared PRD link) and x_components (component list from the PRD); create one child_of task per component deliverable with x_component, x_start_date and x_target_date. Then run ./hey initiative kickoff <id> to freeze the baseline and move plan to active. -->\n`
      : `\n## Context\n<!-- Describe the context for this initiative. -->\n<!-- Set x_initiative_kind: product | business | marketing | ops (decision_adr-product-initiative-kickoff). Optional roadmap timeline: add x_timeline_start and x_timeline_end (YYYY-MM-DD) to the frontmatter above. Setting x_timeline_end schedules this initiative on the roadmap timeline; without it, it stays in Backlog. See decision_adr-initiative-timeline-dates. -->\n`
    : `\n## Context\n<!-- Describe the context for this ${type}. -->\n`;

  writeFileSync(filePath, yamlLines.join('\n') + '\n' + body + '\n', 'utf8');

  return { id, path: filePath, relativePath };
}
