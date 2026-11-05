import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { readArtifactsWithErrors } from './content-io.mjs';

function readYamlFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  return parseYaml(raw) ?? fallback;
}

export function loadRepositoryArtifacts(repoRoot) {
  const root = resolve(repoRoot ?? process.cwd());
  const artifacts = [];
  const loadIssues = [];

  const rootArtifacts = readArtifactsWithErrors(resolve(root, 'content'));
  artifacts.push(...rootArtifacts.artifacts);
  loadIssues.push(...rootArtifacts.errors);

  const membersPath = resolve(root, 'content/vocab/members.yml');
  const membersData = readYamlFile(membersPath, { members: [] });
  const members = (membersData.members ?? [])
    .map((member) => member.name)
    .filter((name) => name !== 'team');

  for (const member of members) {
    const wsDir = resolve(root, 'workspace', member);
    if (!existsSync(wsDir)) continue;

    const workspaceArtifacts = readArtifactsWithErrors(wsDir);
    for (const artifact of workspaceArtifacts.artifacts) {
      if (!artifact.type) continue;
      artifact._workspaceMember = member;
      artifacts.push(artifact);
    }
    loadIssues.push(...workspaceArtifacts.errors);
  }

  return { artifacts, loadIssues };
}
