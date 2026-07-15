import fs from 'node:fs';
import path from 'node:path';
import { git, tryGit } from './git.js';

const CONFIG_FILE = '.design-share.json';

export async function detectRepo(cwd) {
  let root;
  try {
    root = await git(cwd, ['rev-parse', '--show-toplevel']);
  } catch {
    throw new Error('not inside a git repository. cd into your project repo and run npx design-share again.');
  }
  const remote = await tryGit(root, ['remote', 'get-url', 'origin']);
  return { root, name: path.basename(root), remote };
}

export async function detectIdentity(repoRoot) {
  const name = (await tryGit(repoRoot, ['config', 'user.name'])) || '';
  const email = (await tryGit(repoRoot, ['config', 'user.email'])) || '';
  let slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug && email) slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!slug) slug = 'designer';
  return { name: name.trim() || slug, email: email.trim(), slug };
}

export async function currentBranch(repoRoot) {
  const b = await tryGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return b === 'HEAD' ? null : b;
}

export function readRepoConfig(repoRoot) {
  const p = path.join(repoRoot, CONFIG_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeRepoConfig(repoRoot, config) {
  const p = path.join(repoRoot, CONFIG_FILE);
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
  return p;
}

// Returns { type: 'command'|'static', command?, dir?, source, label }
export function detectPreview(repoRoot) {
  const saved = readRepoConfig(repoRoot);
  if (saved && saved.preview && saved.preview.type) {
    return { ...saved.preview, source: 'config' };
  }

  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { pkg = null; }
    const scripts = (pkg && pkg.scripts) || {};
    const deps = { ...(pkg && pkg.dependencies), ...(pkg && pkg.devDependencies) };
    const pick = ['dev', 'start', 'storybook', 'serve'].find((s) => scripts[s]);
    if (pick) {
      let label = `npm run ${pick}`;
      if (deps.vite) label += ' (vite)';
      else if (deps.next) label += ' (next)';
      else if (deps['@storybook/cli'] || pick === 'storybook') label += ' (storybook)';
      return { type: 'command', command: `npm run ${pick}`, source: 'package.json', label };
    }
  }

  if (fs.existsSync(path.join(repoRoot, 'index.html'))) {
    return { type: 'static', dir: '.', source: 'index.html', label: 'static folder' };
  }

  return null;
}
