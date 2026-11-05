import { resolve } from 'node:path';
import { loadManifest } from './indexer.mjs';
import { parseArtifact, writeArtifact } from './content-io.mjs';

export class MarkdownTracker {
  constructor({
    repoRoot,
    manifest = null,
    activeStates = ['ready'],
    terminalStates = ['done', 'archived'],
    dispatchableOwners = ['agent'],
    dispatchableTags = [],
    areaFilter = null
  }) {
    this.repoRoot = resolve(repoRoot);
    this.contentRoot = resolve(this.repoRoot, 'content');
    this.manifest = manifest;
    this.activeStates = activeStates;
    this.terminalStates = terminalStates;
    this.dispatchableOwners = dispatchableOwners;
    this.dispatchableTags = dispatchableTags;
    this.areaFilter = areaFilter;
  }

  /** Fetch candidate tasks eligible for dispatch. Uses manifest only (Tier 1). */
  fetchCandidateIssues() {
    const manifest = this._loadManifest();
    const manifestMap = new Map(manifest.map(m => [m.id, m]));

    return manifest
      .filter(m => m.type === 'task')
      .filter(m => this.activeStates.includes(m.status))
      .filter(m => this._isDispatchable(m))
      .filter(m => !this.areaFilter || m.area === this.areaFilter)
      .filter(m => !this._hasActiveBlockers(m, manifestMap))
      .sort((a, b) => this._comparePriority(a, b))
      .map(m => this._toNormalized(m));
  }

  /** Hydrate a candidate with full body + definition_of_done (Tier 2). */
  hydrateIssue(candidate) {
    const filePath = resolve(this.repoRoot, candidate.path);
    const artifact = parseArtifact(filePath, this.contentRoot);
    return {
      ...candidate,
      description: artifact.body,
      definition_of_done: artifact.frontmatter.definition_of_done ?? []
    };
  }

  /** Update task status in frontmatter. */
  updateIssueState(issueId, newState) {
    const manifest = this._loadManifest();
    const entry = manifest.find(m => m.id === issueId);
    if (!entry) throw new Error(`Task not found: ${issueId}`);

    const filePath = resolve(this.repoRoot, entry.path);
    const artifact = parseArtifact(filePath, this.contentRoot);
    artifact.frontmatter.status = newState;
    artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
    writeArtifact(filePath, artifact.frontmatter, artifact.body);
  }

  /** Record that the assignee has acknowledged a task without changing lifecycle state. */
  acknowledgeIssue(issueId, { by, note = null } = {}) {
    if (!by) throw new Error('Acknowledgement requires a member name');

    const manifest = this._loadManifest();
    const entry = manifest.find(m => m.id === issueId);
    if (!entry) throw new Error(`Task not found: ${issueId}`);

    const filePath = resolve(this.repoRoot, entry.path);
    const artifact = parseArtifact(filePath, this.contentRoot);
    const owner = artifact.frontmatter.owner ?? null;

    if (owner && owner !== by) {
      throw new Error(`Task owner is "${owner}". Only the assignee can acknowledge this task.`);
    }

    artifact.frontmatter.x_acknowledged = {
      by,
      at: new Date().toISOString(),
      ...(note ? { note } : {})
    };
    artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
    writeArtifact(filePath, artifact.frontmatter, artifact.body);
    return artifact.frontmatter.x_acknowledged;
  }

  /** Append a comment under ## Agent Log in the task body. */
  createComment(issueId, comment) {
    const manifest = this._loadManifest();
    const entry = manifest.find(m => m.id === issueId);
    if (!entry) throw new Error(`Task not found: ${issueId}`);

    const filePath = resolve(this.repoRoot, entry.path);
    const artifact = parseArtifact(filePath, this.contentRoot);
    const timestamp = new Date().toISOString();
    const logEntry = `\n### ${timestamp}\n${comment}\n`;

    let body = artifact.body;
    if (body.includes('## Agent Log')) {
      body += logEntry;
    } else {
      body += `\n\n## Agent Log${logEntry}`;
    }

    artifact.frontmatter.updated_at = new Date().toISOString().slice(0, 10);
    writeArtifact(filePath, artifact.frontmatter, body);
  }

  // --- Private helpers ---

  _isDispatchable(entry) {
    const ownerMatch = this.dispatchableOwners.includes(entry.owner);
    const tagMatch =
      this.dispatchableTags.length > 0 &&
      this.dispatchableTags.some(t => (entry.tags ?? []).includes(t));
    return ownerMatch || tagMatch;
  }

  _hasActiveBlockers(entry, manifestMap) {
    const blockers = (entry.relations_out ?? []).filter(r => r.type === 'blocked_by');
    if (blockers.length === 0) return false;
    return blockers.some(b => {
      const target = manifestMap.get(b.target);
      if (!target) return true; // unknown target = blocked
      return !this.terminalStates.includes(target.status);
    });
  }

  _comparePriority(a, b) {
    const pa = this._priorityNum(a.priority);
    const pb = this._priorityNum(b.priority);
    if (pa !== pb) return pa - pb;
    return (a.created_at || '').localeCompare(b.created_at || '');
  }

  _priorityNum(p) {
    const map = { do: 0, plan: 1, routine: 2, drop: 3 };
    return map[p] ?? 99;
  }

  _loadManifest() {
    return this.manifest ?? loadManifest(this.repoRoot);
  }

  _toNormalized(m) {
    return {
      id: m.id,
      identifier: m.id,
      title: m.title,
      priority: this._priorityNum(m.priority),
      state: m.status,
      labels: m.tags ?? [],
      owner: m.owner ?? null,
      area: m.area ?? null,
      due_date: m.due_date ?? null,
      iteration: m.iteration ?? null,
      created_at: m.created_at,
      updated_at: m.updated_at,
      path: m.path,
      content_hash: m.hashes?.content_hash ?? '',
      // Hydration fields (empty until hydrateIssue is called)
      description: '',
      definition_of_done: [],
      blocked_by: (m.relations_out ?? [])
        .filter(r => r.type === 'blocked_by')
        .map(r => ({ id: r.target, identifier: r.target, state: null }))
    };
  }
}
