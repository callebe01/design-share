import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP_SOURCE = path.join(PKG_ROOT, 'dist', 'DesignShare.app');
const APP_TARGET = path.join(os.homedir(), 'Applications', 'DesignShare.app');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout.trim());
    });
  });
}

export function appAvailable() {
  return process.platform === 'darwin' && fs.existsSync(APP_SOURCE);
}

export function appInstalled() {
  return fs.existsSync(APP_TARGET);
}

export async function installApp() {
  if (process.platform !== 'darwin') throw new Error('the menu bar app is macOS only.');
  if (!fs.existsSync(APP_SOURCE)) {
    throw new Error('the menu bar app is not bundled in this package build. run scripts/build-app.sh first.');
  }
  fs.mkdirSync(path.dirname(APP_TARGET), { recursive: true });
  fs.rmSync(APP_TARGET, { recursive: true, force: true });
  // ditto preserves the bundle structure and extended attributes, including the signature.
  await run('ditto', [APP_SOURCE, APP_TARGET]);
  return APP_TARGET;
}

export async function launchApp() {
  await run('open', ['-g', APP_TARGET]);
}

export async function quitApp() {
  try {
    await run('osascript', ['-e', 'tell application "DesignShare" to quit']);
  } catch { /* not running */ }
}
