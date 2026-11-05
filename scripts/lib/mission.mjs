import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkDependencies } from './deps.mjs';
import { loadManifest } from './indexer.mjs';
import { currentIteration } from './iteration.mjs';
import { parseArtifact } from './content-io.mjs';

function readTextIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function resolveArtifactPath(repoRoot, entry) {
  return resolve(repoRoot, entry.path);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function asArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function profilePath(repoRoot, owner) {
  if (!owner) return null;
  return resolve(repoRoot, 'workspace', owner, 'profile.md');
}

function inferRuntimeTargets(task, body, ownerProfile) {
  const text = `${task.title ?? ''}\n${task.area ?? ''}\n${body}\n${ownerProfile}`.toLowerCase();
  const repos = [];

  if (task.area === 'Team' || task.area === 'Infra' || text.includes('hey-mgmt') || text.includes('./hey')) {
    repos.push('hey-mgmt');
  }
  if (task.area === 'App' || text.includes('frontend') || text.includes('react')) {
    repos.push('app-frontend');
  }
  if (task.area === 'Core' || text.includes('backend') || text.includes('api')) {
    repos.push('core-service');
  }

  return {
    repos: unique(repos.length > 0 ? repos : ['hey-mgmt']),
    adapter_status: 'candidate',
    notes: [
      'Runtime targets are inferred from task area, body, and owner profile.',
      'Product repo adapter commands are advisory until an adapter contract exists.',
    ],
  };
}

function deriveEvidenceChecklist(task, dependencyResult) {
  const evidence = [
    './hey validate result for hey-mgmt artifact changes',
    'changed files list',
    'git commit hash',
  ];

  if (task.area === 'App') {
    evidence.push('product repo build/test or smoke result');
  }
  if (task.area === 'Core' || task.area === 'Product') {
    evidence.push('domain test or dry-run evidence');
  }
  if ((dependencyResult?.matches ?? []).length > 0) {
    evidence.push('dependency obligations reviewed and either applied or ruled out');
  }

  return unique(evidence);
}

function deriveEscalationRules(task, dependencyResult) {
  const rules = [
    'Ask before using production credentials or mutating live systems.',
    'Ask when external API contracts, billing/accounting/risk semantics, permissions, or legal wording change.',
    'Ask when validation fails for reasons unrelated to the scoped task.',
  ];

  if ((dependencyResult?.matches ?? []).length > 0) {
    rules.push('Escalate if any matched dependency obligation is relevant but cannot be satisfied in the current run.');
  }
  if (task.owner && task.owner !== 'agent') {
    rules.push(`Escalate unresolved product or domain judgment to ${task.owner}.`);
  }

  return rules;
}

function relatedArtifacts(manifest, taskArtifact) {
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const ids = unique([
    ...(taskArtifact.relationsOut ?? []).map((relation) => relation.target),
    ...(taskArtifact.linksOut ?? []),
  ]);

  return ids.map((id) => {
    const item = byId.get(id);
    return item
      ? {
          id: item.id,
          title: item.title,
          type: item.type,
          status: item.status ?? null,
          owner: item.owner ?? null,
          path: item.path,
        }
      : {
          id,
          missing: true,
        };
  });
}

export function compileMissionBrief(repoRoot, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const taskId = options.taskId;
  if (!taskId) throw new Error('Mission compile requires taskId');

  const manifest = loadManifest(root);
  const task = manifest.find((item) => item.type === 'task' && item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const taskPath = resolveArtifactPath(root, task);
  const taskArtifact = parseArtifact(taskPath, resolve(root, 'content'));
  const ownerProfilePath = profilePath(root, task.owner);
  const ownerProfile = ownerProfilePath ? readTextIfExists(ownerProfilePath) : '';
  const intent = `${task.title}\n${taskArtifact.body}`;
  const dependencyResult = checkDependencies({
    repoRoot: root,
    intent,
    area: task.area ?? null,
    limit: Number(options.dependencyLimit ?? 5),
  });
  const runtimeTargets = taskArtifact.frontmatter.x_runtime_targets
    ?? inferRuntimeTargets(task, taskArtifact.body, ownerProfile);
  const evidenceChecklist = [
    ...deriveEvidenceChecklist(task, dependencyResult),
    ...asArray(taskArtifact.frontmatter.x_required_evidence),
  ];
  const escalationRules = [
    ...deriveEscalationRules(task, dependencyResult),
    ...asArray(taskArtifact.frontmatter.x_escalation),
  ];

  return {
    schema_version: 'mission.v1',
    generated_at: new Date().toISOString(),
    task: {
      id: task.id,
      title: task.title,
      status: task.status ?? null,
      owner: task.owner ?? null,
      area: task.area ?? null,
      priority: task.priority ?? null,
      due_date: task.due_date ?? null,
      iteration: task.iteration ?? null,
      path: task.path,
      definition_of_done: asArray(taskArtifact.frontmatter.definition_of_done),
      body: taskArtifact.body,
    },
    derived: {
      current_iteration: currentIteration(),
      runtime_targets: runtimeTargets,
      evidence_checklist: unique(evidenceChecklist),
      escalation_rules: unique(escalationRules),
      evaluation: unique([
        './hey validate',
        ...asArray(taskArtifact.frontmatter.x_evaluation),
      ]),
    },
    related_artifacts: relatedArtifacts(manifest, taskArtifact),
    sources: asArray(taskArtifact.frontmatter.sources),
    owner_profile: ownerProfile
      ? {
          path: ownerProfilePath.replace(`${root}/`, ''),
          excerpt: ownerProfile.slice(0, Number(options.profileExcerptChars ?? 4000)),
        }
      : null,
    dependencies: {
      matches: dependencyResult.matches,
      obligations: dependencyResult.obligations,
      verification: dependencyResult.verification,
    },
    approval_boundary: {
      human_approval_required_for: [
        'production credentials or live-system mutation',
        'external API contract changes',
        'APY, accounting, risk, or protocol semantics',
        'contract ownership, permission, or keeper policy changes',
        'ambiguous domain evidence',
      ],
    },
  };
}

export function renderMissionMarkdown(mission) {
  const lines = [
    `# Mission Brief: ${mission.task.title}`,
    '',
    '## Task',
    '',
    `- ID: ${mission.task.id}`,
    `- Owner: ${mission.task.owner ?? '-'}`,
    `- Area: ${mission.task.area ?? '-'}`,
    `- Status: ${mission.task.status ?? '-'}`,
    `- Priority: ${mission.task.priority ?? '-'}`,
    `- Iteration: ${mission.task.iteration ?? '-'}`,
    `- Path: ${mission.task.path}`,
    '',
    '## Definition Of Done',
    '',
    ...mission.task.definition_of_done.map((item) => `- ${item}`),
    '',
    '## Runtime Targets',
    '',
    ...mission.derived.runtime_targets.repos.map((repo) => `- ${repo}`),
    '',
    '## Evidence Checklist',
    '',
    ...mission.derived.evidence_checklist.map((item) => `- ${item}`),
    '',
    '## Escalation Rules',
    '',
    ...mission.derived.escalation_rules.map((item) => `- ${item}`),
    '',
    '## Dependency Matches',
    '',
  ];

  if (mission.dependencies.matches.length === 0) {
    lines.push('- None');
  } else {
    for (const match of mission.dependencies.matches) {
      lines.push(`- ${match.id}: ${match.title}`);
    }
  }

  lines.push('', '## Related Artifacts', '');
  if (mission.related_artifacts.length === 0) {
    lines.push('- None');
  } else {
    for (const item of mission.related_artifacts) {
      lines.push(`- ${item.id}${item.title ? `: ${item.title}` : ''}`);
    }
  }

  lines.push('', '## Task Body', '', mission.task.body || '(empty)', '');
  return lines.join('\n');
}

export function writeMissionPack(repoRoot, mission, options = {}) {
  const root = resolve(repoRoot ?? process.cwd());
  const outDir = resolve(root, options.outDir ?? `.hey/missions/${mission.task.id}`);
  mkdirSync(outDir, { recursive: true });

  const jsonPath = resolve(outDir, 'mission.json');
  const mdPath = resolve(outDir, 'mission.md');
  writeFileSync(jsonPath, `${JSON.stringify(mission, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, `${renderMissionMarkdown(mission)}\n`, 'utf8');

  return {
    out_dir: outDir,
    json_path: jsonPath,
    markdown_path: mdPath,
  };
}
