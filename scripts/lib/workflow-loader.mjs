import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import matter from 'gray-matter';
import { MiniTemplate } from './mini-template.mjs';

export class WorkflowLoader {
  constructor(repoRoot) {
    this.repoRoot = resolve(repoRoot);
    this.templateEngine = new MiniTemplate();
    this._config = null;
    this._promptTemplate = null;
  }

  /** Load and parse WORKFLOW.md. Returns the config object. */
  load() {
    const path = resolve(this.repoRoot, 'WORKFLOW.md');
    const raw = readFileSync(path, 'utf8');
    const parsed = matter(raw);
    this._config = parsed.data;
    this._promptTemplate = parsed.content.trim();
    return this._config;
  }

  /** Get config (loads if needed). */
  get config() {
    if (!this._config) this.load();
    return this._config;
  }

  /** Get the raw prompt template. */
  get promptTemplate() {
    if (!this._promptTemplate) this.load();
    return this._promptTemplate;
  }

  /** Render the prompt template with issue data + context pack. */
  renderPrompt(issue, vars = {}) {
    const template = this.promptTemplate;
    return this.templateEngine.render(template, { issue, ...vars });
  }
}
