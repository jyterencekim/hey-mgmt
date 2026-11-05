import { validateFrontmatterSchema } from './frontmatter-schema.mjs';
import {
  buildEntityRegistry,
  buildRepoRegistry,
  DEPENDENCY_NOTES_PREFIX,
  DEPENDENCY_SEVERITIES,
  DEPENDENCY_TAG,
  isDependencyNoteCandidate,
  normalizeChangeContract,
} from './dependency-utils.mjs';
import {
  buildInitiativeMembership,
  entryFromArtifact,
  isActiveProduct,
  kickoffIsEnforced,
  missingKickoffFields,
} from './product-initiative-rules.mjs';

const ID_RE = /^(?:task|decision|meeting|playbook|note|initiative|goal)_[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const LINKS_TO_DEPRECATION_DATE = '2026-09-15';

const RELATION_TYPES = new Set([
  'links_to',
  'supports',
  'supersedes',
  'duplicates',
  'blocks',
  'blocked_by',
  'implements',
  'implemented_by',
  'mentioned_in',
  'parent_of',
  'child_of',
  'contributes_to',
  'advanced_by',
  'follows',
  'mentions',
  'superseded_by',
  'evidenced_by',
  'evidence_for',
]);

function expectedPrefixForType(type) {
  const map = {
    task: 'task',
    decision: 'decision',
    meeting: 'meeting',
    playbook: 'playbook',
    note: 'note',
    initiative: 'initiative',
    goal: 'goal',
  };

  return map[type] ?? null;
}

function validateCommon(artifact, issues) {
  const fieldHints = {
    id: 'Format: [type]_[slug], e.g. task_my-task-name',
    type: 'Valid: task, decision, meeting, playbook, note, initiative, goal',
    created_at: 'Format: YYYY-MM-DD or ISO 8601 datetime with KST, e.g. 2026-03-04 or 2026-03-04T14:30:00+09:00',
    updated_at: 'Format: YYYY-MM-DD or ISO 8601 datetime with KST, e.g. 2026-03-04 or 2026-03-04T14:30:00+09:00',
  };
  const required = ['id', 'type', 'created_at', 'updated_at'];
  for (const field of required) {
    if (!(field in artifact.frontmatter)) {
      issues.push({
        level: 'error',
        id: artifact.id || '(missing-id)',
        path: artifact.relativePath,
        message: `missing required field: ${field}. ${fieldHints[field] || ''}`
      });
    }
  }
}

function pushError(issues, artifact, message) {
  issues.push({
    level: 'error',
    id: artifact.id,
    path: artifact.relativePath,
    message
  });
}

function pushWarning(issues, artifact, message) {
  issues.push({
    level: 'warning',
    id: artifact.id,
    path: artifact.relativePath,
    message
  });
}

function validateTypeSpecific(artifact, issues) {
  const fm = artifact.frontmatter;
  const push = (message) => pushError(issues, artifact, message);

  if (artifact.type === 'task' && (!Array.isArray(fm.definition_of_done) || fm.definition_of_done.length === 0)) {
    push('task requires definition_of_done[]. Add definition_of_done: ["criterion1", "criterion2"] to frontmatter');
  }

  if (artifact.type === 'decision') {
    if (typeof fm.decision_status !== 'string' || !fm.decision_status) {
      push('decision requires decision_status. Valid: proposed, accepted, deprecated, superseded');
    }
    if (!Array.isArray(fm.owners) || fm.owners.length === 0) {
      push('decision requires owners[]. Add owners: ["person-name"] to frontmatter');
    }
  }

  if (artifact.type === 'meeting') {
    if (!Array.isArray(fm.attendees) || fm.attendees.length === 0) push('meeting requires attendees[]. Add attendees: ["person-name"] to frontmatter');
    if (typeof fm.start_at !== 'string') push('meeting requires start_at. Format: ISO 8601 datetime, e.g. 2026-03-04T10:00:00Z');
    if (typeof fm.end_at !== 'string') push('meeting requires end_at. Format: ISO 8601 datetime, e.g. 2026-03-04T11:00:00Z');
  }

  if (artifact.type === 'playbook') {
    if (typeof fm.playbook_version !== 'string' || !fm.playbook_version) push('playbook requires playbook_version. Format: semver string, e.g. "1.0.0"');
  }

  if (artifact.type === 'initiative') {
    if (!Array.isArray(fm.definition_of_done) || fm.definition_of_done.length === 0) {
      push('initiative requires definition_of_done[]. Add definition_of_done: ["criterion1", "criterion2"] to frontmatter');
    }
    if ('iteration' in fm) push('initiative must not have iteration (initiatives are not iterable work units)');
    if ('due_date' in fm) push('initiative must not have due_date (initiatives track strategic efforts, not deadlines)');
    if (typeof fm.x_timeline_start === 'string' && typeof fm.x_timeline_end === 'string') {
      // Normalize both to a bare YYYY-MM-DD (YAML may parse a bare date to an ISO
      // timestamp) so the lexicographic compare matches the indexer's stored form.
      const tlStart = fm.x_timeline_start.slice(0, 10);
      const tlEnd = fm.x_timeline_end.slice(0, 10);
      if (tlStart > tlEnd) {
        pushWarning(issues, artifact, `initiative x_timeline_start (${tlStart}) is after x_timeline_end (${tlEnd}); check the timeline dates`);
      }
    }
  }

  if (artifact.type === 'goal') {
    if ('iteration' in fm) push('goal must not have iteration (goals are not iterable work units)');
    if ('due_date' in fm) push('goal must not have due_date (goals express timebox via target_date, not deadlines)');
  }

  // note: no special requirements
}

function enforcePolicy(artifact, policy, issues) {
  const sources = Array.isArray(artifact.frontmatter.sources) ? artifact.frontmatter.sources : [];
  const config = policy?.sources_policy?.[artifact.type];
  const minRefs = Number(config?.min_refs ?? 0);

  if (minRefs > 0 && sources.length < minRefs) {
    issues.push({
      level: 'error',
      id: artifact.id,
      path: artifact.relativePath,
      message: `${artifact.type} requires at least ${minRefs} sources ref(s)`
    });
  }
}

function validateTags(artifact, vocabTags, issues) {
  const tags = artifact.frontmatter?.tags;
  if (!tags || !Array.isArray(tags)) return;
  const allowed = new Set(vocabTags.tags ?? []);
  if (allowed.size === 0) return;
  for (const tag of tags) {
    if (!allowed.has(tag)) {
      pushWarning(issues, artifact, `tag '${tag}' not in vocabulary. Allowed: ${[...allowed].join(', ')}`);
    }
  }
}

function validateOwner(artifact, vocabMembers, issues) {
  const owner = artifact.frontmatter?.owner;
  if (!owner || owner === 'null') return;
  const members = (vocabMembers.members ?? []).map(m => m.name);
  if (members.length === 0) return;
  if (members.length > 0 && !members.includes(owner)) {
    pushWarning(issues, artifact, `owner '${owner}' not in members registry. Known: ${members.join(', ')}`);
  }
}

function validateArea(artifact, vocabAreas, issues) {
  const area = artifact.frontmatter?.area;
  if (!area) return;
  const areas = (vocabAreas.areas ?? []).map(p => p.name);
  if (areas.length === 0) return;
  if (areas.length > 0 && !areas.includes(area)) {
    pushWarning(issues, artifact, `area '${area}' not in areas registry. Known: ${areas.join(', ')}`);
  }
}

function validateEntityNames(artifact, vocabEntities, issues) {
  const entities = artifact.frontmatter?.entities;
  if (!Array.isArray(entities)) return;
  const entityList = vocabEntities.entities ?? [];
  if (entityList.length === 0) return;
  const knownNames = new Set();
  for (const entry of entityList) {
    knownNames.add(String(entry.canonical).toLowerCase());
    for (const alias of (entry.aliases ?? [])) {
      knownNames.add(String(alias).toLowerCase());
    }
  }
  const canonicalNames = entityList.map((e) => e.canonical);
  for (const entity of entities) {
    const name = entity?.name ?? entity;
    if (typeof name !== 'string') continue;
    if (!knownNames.has(name.toLowerCase())) {
      pushWarning(issues, artifact, `entity '${name}' is not in known vocabulary. Known entities: ${canonicalNames.join(', ')}`);
    }
  }
}

function validateMembersArray(artifact, field, vocabMembers, issues) {
  const values = artifact.frontmatter?.[field];
  if (!Array.isArray(values) || values.length === 0) return;
  const members = new Set((vocabMembers.members ?? []).map((member) => member.name));
  if (members.size === 0) return;
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (!members.has(value)) {
      pushWarning(issues, artifact, `${field} entry '${value}' not in members registry`);
    }
  }
}

function validateDependencyNote(artifact, vocab, issues) {
  const push = (message) => pushError(issues, artifact, message);
  const hasContract = artifact.frontmatter?.x_change_contract && typeof artifact.frontmatter.x_change_contract === 'object';

  // Placement rules: a note filed under notes/dependencies/ must be a full
  // dependency note (tag + contract + evidence).
  if (isDependencyNoteCandidate(artifact)) {
    const tags = Array.isArray(artifact.frontmatter?.tags) ? artifact.frontmatter.tags : [];
    if (!tags.includes(DEPENDENCY_TAG)) {
      push(`dependency notes under '${DEPENDENCY_NOTES_PREFIX}' must include tag '${DEPENDENCY_TAG}'`);
    }

    if (!hasContract) {
      push("dependency note requires x_change_contract frontmatter");
      return;
    }

    const sources = Array.isArray(artifact.frontmatter?.sources) ? artifact.frontmatter.sources : [];
    if (sources.length === 0) {
      push('dependency note requires at least one source');
    }

    if (artifact.relationsOut.length === 0) {
      push('dependency note requires at least one relation');
    }
  }

  // Contract rules: apply to ANY content artifact carrying x_change_contract
  // (the pool is KB-wide — see decision_adr-kb-wide-change-contracts).
  // terms[]/intents[] are optional precision boosters: recall comes from qmd
  // semantic search plus full title/body lexical matching, so at least one
  // trigger signal of any kind is enough.
  if (!hasContract || artifact._workspaceMember) return;

  // A contract without the opt-in tag never enters the deps pool — silent
  // dead weight. Surface it instead of letting it rot. (Placed dependency
  // notes already get a hard error above, so don't double-report them.)
  const carrierTags = Array.isArray(artifact.frontmatter?.tags) ? artifact.frontmatter.tags : [];
  if (!carrierTags.includes(DEPENDENCY_TAG) && !isDependencyNoteCandidate(artifact)) {
    pushWarning(issues, artifact, `x_change_contract present but tag '${DEPENDENCY_TAG}' missing — the contract will not enter the deps check pool`);
  }

  const entityRegistry = buildEntityRegistry(vocab.entities ?? { entities: [] });
  const repoRegistry = buildRepoRegistry(vocab.repos ?? { repos: [] });
  const contract = normalizeChangeContract(artifact.frontmatter.x_change_contract, entityRegistry);

  const triggerSignals =
    contract.triggers.repos.length +
    contract.triggers.paths.length +
    contract.triggers.areas.length +
    contract.triggers.entities.length +
    contract.triggers.intents.length +
    contract.triggers.terms.length;
  if (triggerSignals === 0) {
    push('x_change_contract requires at least one trigger signal in triggers (repos/paths/areas/entities/intents/terms)');
  }

  if (contract.obligations.length === 0) {
    push('x_change_contract requires obligations[] with at least one entry');
  }

  for (const repoName of contract.triggers.repos) {
    if (!repoRegistry.has(repoName)) {
      push(`dependency trigger repo '${repoName}' not in repos registry`);
    }
  }

  const knownAreas = new Set((vocab.areas?.areas ?? []).map((area) => area.name));
  for (const areaName of contract.triggers.areas) {
    if (!knownAreas.has(areaName)) {
      push(`dependency trigger area '${areaName}' not in areas registry`);
    }
  }

  const knownEntityTerms = entityRegistry.lookup;
  for (const entityName of contract.triggers.entities) {
    if (!knownEntityTerms.has(entityName.toLowerCase())) {
      push(`dependency trigger entity '${entityName}' not in entities registry`);
    }
  }

  for (const obligation of contract.obligations) {
    if (!obligation.title) {
      push('dependency obligation requires title');
    }
    if (!DEPENDENCY_SEVERITIES.has(obligation.severity)) {
      push(`dependency obligation severity '${obligation.severity}' invalid. Valid: ${[...DEPENDENCY_SEVERITIES].join(', ')}`);
    }
    if (obligation.actions.length === 0) {
      push(`dependency obligation '${obligation.title || '(untitled)'}' requires at least one action`);
    }

    for (const repoName of obligation.repos) {
      if (!repoRegistry.has(repoName)) {
        push(`dependency obligation repo '${repoName}' not in repos registry`);
      }
    }

    for (const entityName of obligation.entities) {
      if (!knownEntityTerms.has(entityName.toLowerCase())) {
        push(`dependency obligation entity '${entityName}' not in entities registry`);
      }
    }
  }
}

const TERMINAL_TASK_STATUSES = new Set(['done', 'archived', 'cancelled']);

// GP3 staleness threshold (days without an update). Shared with `hey hygiene
// check` so there is one staleness system, not two.
export const STALE_DAYS = 90;

function isStalenessExempt(artifact) {
  if (artifact.type !== 'task') return true;
  const fm = artifact.frontmatter ?? {};
  if (TERMINAL_TASK_STATUSES.has(fm.status)) return true;
  if (fm.x_evergreen === true) return true;
  return false;
}

function validateFreshness(artifact, issues, staleDays = STALE_DAYS) {
  if (isStalenessExempt(artifact)) return;
  const updatedAt = artifact.frontmatter?.updated_at;
  if (!updatedAt) return;
  const date = new Date(updatedAt);
  if (isNaN(date.getTime())) return;
  const daysSince = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince > staleDays) {
    issues.push({
      level: 'warning',
      id: artifact.id,
      path: artifact.relativePath,
      message: `artifact is stale (last updated ${daysSince} days ago, threshold: ${staleDays} days). Consider reviewing and updating.`
    });
  }
}

export { isStalenessExempt };

export function validateArtifacts(artifacts, policy = {}, vocab = {}) {
  const issues = [];
  const idSet = new Set();
  const idToArtifact = new Map();

  for (const artifact of artifacts) {
    validateCommon(artifact, issues);
    validateFrontmatterSchema(artifact, issues);

    if (!ID_RE.test(artifact.id)) {
      issues.push({
        level: 'error',
        id: artifact.id,
        path: artifact.relativePath,
        message: `invalid id format: ${artifact.id}`
      });
    }

    const expectedPrefix = expectedPrefixForType(artifact.type);
    if (expectedPrefix && !artifact.id.startsWith(`${expectedPrefix}_`)) {
      issues.push({
        level: 'error',
        id: artifact.id,
        path: artifact.relativePath,
        message: `id prefix must be ${expectedPrefix}_ for type ${artifact.type}`
      });
    }

    if (idSet.has(artifact.id)) {
      issues.push({ level: 'error', id: artifact.id, path: artifact.relativePath, message: 'duplicate id' });
    }

    idSet.add(artifact.id);
    idToArtifact.set(artifact.id, artifact);

    if (Array.isArray(artifact.frontmatter.relations)) {
      for (const relation of artifact.frontmatter.relations) {
        if (typeof relation === 'string') {
          // bare ID → links_to (handled by parser). Deprecated for artifacts touched from
          // 2026-09-15 (decision_adr-kg-v2-operating-decisions D4): warn, do not block.
          if (String(artifact.frontmatter.updated_at ?? '').slice(0, 10) >= LINKS_TO_DEPRECATION_DATE) {
            issues.push({
              level: 'warning',
              id: artifact.id,
              path: artifact.relativePath,
              message: `bare-string relation '${relation}' is untyped links_to; use {type, target} with supports, implements, blocked_by, parent_of, child_of, follows, supersedes or mentions (decision_adr-kg-v2-operating-decisions D4)`
            });
          }
          continue;
        }
        const relationType = String(relation?.type ?? '');
        if (!RELATION_TYPES.has(relationType)) {
          issues.push({
            level: 'warning',
            id: artifact.id,
            path: artifact.relativePath,
            message: `unknown relation type: '${relationType}'. Valid: ${[...RELATION_TYPES].join(', ')}`
          });
        }
      }
    }

    validateTypeSpecific(artifact, issues);
    validateTags(artifact, vocab.tags ?? {}, issues);
    validateOwner(artifact, vocab.members ?? { members: [] }, issues);
    validateMembersArray(artifact, 'owners', vocab.members ?? { members: [] }, issues);
    validateMembersArray(artifact, 'attendees', vocab.members ?? { members: [] }, issues);
    validateMembersArray(artifact, 'watchers', vocab.members ?? { members: [] }, issues);
    validateArea(artifact, vocab.areas ?? { areas: [] }, issues);
    validateEntityNames(artifact, vocab.entities ?? { entities: [] }, issues);
    validateDependencyNote(artifact, vocab, issues);
    validateFreshness(artifact, issues);
    enforcePolicy(artifact, policy, issues);
  }

  for (const artifact of artifacts) {
    for (const relation of artifact.relationsOut) {
      if (!idToArtifact.has(relation.target)) {
        issues.push({
          level: 'error',
          id: artifact.id,
          path: artifact.relativePath,
          message: `relation target not found: ${relation.target}`
        });
      }

      if (relation.type === 'contributes_to') {
        const target = idToArtifact.get(relation.target);
        if (artifact.type === 'goal') {
          pushWarning(issues, artifact, `contributes_to must originate from an initiative, not a goal (${artifact.id} is a goal)`);
        } else if (artifact.type !== 'initiative') {
          pushWarning(issues, artifact, `contributes_to should originate from an initiative (${artifact.id} is a ${artifact.type})`);
        }
        if (target && target.type !== 'goal') {
          pushWarning(issues, artifact, `contributes_to target should be a goal, but ${relation.target} is a ${target.type}`);
        }
      }
    }
  }

  validateProductInitiatives(artifacts, issues);

  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    issues
  };
}

// decision_adr-product-initiative-kickoff D2/D6: an active product initiative
// must carry its kickoff contract (error for initiatives created on/after the
// effective date, warning for older ones until backfilled). Task-level gaps are
// alerts, not validation failures, except a component outside the PRD list.
function validateProductInitiatives(artifacts, issues) {
  const entries = artifacts.map(entryFromArtifact);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const membership = buildInitiativeMembership(entries);

  for (const entry of entries) {
    if (entry.type !== 'initiative') continue;
    const artifact = artifactById.get(entry.id);
    if (entry.status === 'active' && !entry.initiative_kind) {
      pushWarning(issues, artifact, 'active initiative has no x_initiative_kind (product | business | marketing | ops); see decision_adr-product-initiative-kickoff');
    }
    if (!isActiveProduct(entry)) continue;

    const missing = missingKickoffFields(entry);
    if (missing.length > 0) {
      const message = `active product initiative is missing ${missing.map((gap) => gap.field).join(', ')}; run ./hey initiative kickoff after filling the PRD and dates (decision_adr-product-initiative-kickoff)`;
      if (kickoffIsEnforced(entry)) pushError(issues, artifact, message);
      else pushWarning(issues, artifact, message);
    }
    for (const id of entry.baseline_tasks) {
      if (!byId.has(id)) pushWarning(issues, artifact, `x_baseline_tasks references unknown task ${id}`);
    }
    if (entry.components.length === 0) continue;
    for (const taskId of membership.get(entry.id) ?? []) {
      const task = byId.get(taskId);
      if (task?.component && !entry.components.includes(task.component)) {
        pushWarning(issues, artifactById.get(taskId), `x_component '${task.component}' is not in ${entry.id} x_components (${entry.components.join(', ')})`);
      }
    }
  }
}
