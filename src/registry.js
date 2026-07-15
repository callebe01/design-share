import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The menu bar app reads this registry to know which repos have daemons,
// where they listen, and how to respawn one that died with the terminal.
const DIR = path.join(os.homedir(), '.design-share');
const FILE = path.join(DIR, 'daemons.json');
const CONFIG = path.join(DIR, 'config.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function readRegistry() {
  return readJson(FILE, { repos: {} });
}

export function upsertDaemon(repoRoot, entry) {
  const reg = readRegistry();
  reg.repos[repoRoot] = { ...reg.repos[repoRoot], ...entry, updatedAt: Date.now() };
  writeJson(FILE, reg);
}

export function removeDaemon(repoRoot) {
  const reg = readRegistry();
  delete reg.repos[repoRoot];
  writeJson(FILE, reg);
}

export function readUserConfig() {
  return readJson(CONFIG, {});
}

export function writeUserConfig(patch) {
  writeJson(CONFIG, { ...readUserConfig(), ...patch });
}
