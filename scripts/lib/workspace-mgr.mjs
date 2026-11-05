import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs';
import { resolve, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { MiniTemplate } from './mini-template.mjs';

export class WorkspaceManager {
  constructor({ repoRoot, workspaceRoot, hooks = {}, hookTimeoutMs = 60000 }) {
    this.repoRoot = resolve(repoRoot);
    this.workspaceRoot = resolve(repoRoot, workspaceRoot || '.hey/orch/workspaces');
    this.hooks = hooks;
    this.hookTimeoutMs = hookTimeoutMs;
    this.template = new MiniTemplate();
    mkdirSync(this.workspaceRoot, { recursive: true });
  }

  /** Create or return existing worktree for a task. */
  ensureWorkspace(issue) {
    const wsPath = resolve(this.workspaceRoot, issue.id);
    const createdNow = !existsSync(wsPath);

    if (createdNow && this.hooks.after_create) {
      this._runHook('after_create', this.hooks.after_create, { issue, workspace_path: wsPath });
    }

    return { path: wsPath, createdNow };
  }

  /** Run after_complete hook (push + create PR). */
  async runAfterCompleteHook(issue, workspace) {
    if (!this.hooks.after_complete) return { pr_url: null };

    const output = this._runHook('after_complete', this.hooks.after_complete, {
      issue,
      workspace_path: workspace.path
    });

    // Try to extract PR URL from output
    const prMatch = (output || '').match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);
    return { pr_url: prMatch ? prMatch[0] : null };
  }

  /** Remove a workspace (worktree). */
  removeWorkspace(taskId) {
    const wsPath = resolve(this.workspaceRoot, taskId);
    if (!existsSync(wsPath)) return;

    if (this.hooks.before_remove) {
      try {
        this._runHook('before_remove', this.hooks.before_remove, {
          issue: { identifier: taskId, id: taskId },
          workspace_path: wsPath
        });
      } catch { /* best effort */ }
    }

    try { rmSync(wsPath, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  /** List all existing workspaces. */
  listWorkspaces() {
    if (!existsSync(this.workspaceRoot)) return [];
    return readdirSync(this.workspaceRoot, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ taskId: d.name, path: resolve(this.workspaceRoot, d.name) }));
  }

  /** Clean workspaces older than given hours. */
  cleanStale(maxHours = 4) {
    const workspaces = this.listWorkspaces();
    const cutoff = Date.now() - (maxHours * 3600000);
    const cleaned = [];

    for (const ws of workspaces) {
      try {
        const stat = statSync(ws.path);
        if (stat.mtimeMs < cutoff) {
          this.removeWorkspace(ws.taskId);
          cleaned.push(ws.taskId);
        }
      } catch { /* skip */ }
    }
    return cleaned;
  }

  _runHook(name, template, vars) {
    const rendered = this.template.render(template, vars);
    try {
      const output = execSync(rendered, {
        cwd: vars.workspace_path || this.repoRoot,
        timeout: this.hookTimeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
      return output;
    } catch (err) {
      console.error(`Hook ${name} failed: ${err.message}`);
      return '';
    }
  }
}
