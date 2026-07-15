import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { git, tryGit } from './git.js';
import { startInjectingProxy } from './proxy.js';

const URL_RE = /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+[^\s'"]*)/;
const START_TIMEOUT_MS = 90_000;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.txt': 'text/plain',
};

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

async function findFreePort(start) {
  let port = start;
  while (!(await portFree(port))) port++;
  return port;
}

export class PreviewManager {
  constructor(repoRoot, previewConfig, identity) {
    this.repoRoot = repoRoot;
    this.previewConfig = previewConfig;
    this.identity = identity;
    this.previews = new Map(); // key user/branch -> record
    this.nextPort = 4501;
    this.worktreeBase = path.join(repoRoot, '.design-share', 'worktrees');
  }

  ensureExcluded() {
    // Keeps the hidden worktree area out of git status for everyone,
    // without touching the repo's committed .gitignore.
    try {
      const exclude = path.join(this.repoRoot, '.git', 'info', 'exclude');
      const line = '.design-share/';
      const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
      if (!cur.split('\n').includes(line)) {
        fs.mkdirSync(path.dirname(exclude), { recursive: true });
        fs.writeFileSync(exclude, cur + (cur.endsWith('\n') || cur === '' ? '' : '\n') + line + '\n');
      }
    } catch { /* non fatal */ }
  }

  get(key) {
    return this.previews.get(key);
  }

  statuses() {
    const out = {};
    for (const [key, p] of this.previews) {
      out[key] = {
        status: p.status, url: p.url, commit: p.commit || null,
        error: p.error || null, logTail: p.log.slice(-1600),
      };
    }
    return out;
  }

  async ensureOwn(branch) {
    const key = `${this.identity.slug}/${branch}`;
    const existing = this.previews.get(key);
    if (existing && existing.status !== 'error' && existing.status !== 'stopped') return existing;
    const commit = await tryGit(this.repoRoot, ['rev-parse', 'HEAD']);
    return this.start(key, { cwd: this.repoRoot, commit, own: true });
  }

  async ensureBranch(user, branch, ownBranch) {
    if (user === this.identity.slug && branch === ownBranch) {
      return this.ensureOwn(branch);
    }
    const key = `${user}/${branch}`;
    await tryGit(this.repoRoot, ['fetch', '--quiet', 'origin', branch]);
    const commit = await tryGit(this.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`])
      || await tryGit(this.repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    if (!commit) {
      const rec = this.record(key);
      rec.status = 'error';
      rec.error = `branch ${branch} was not found on origin. the author may not have pushed yet.`;
      return rec;
    }

    const existing = this.previews.get(key);
    if (existing && existing.status !== 'error' && existing.status !== 'stopped') {
      if (existing.commit !== commit && existing.worktree) {
        await tryGit(existing.worktree, ['checkout', '--quiet', '--detach', commit]);
        existing.commit = commit;
      }
      return existing;
    }

    this.ensureExcluded();
    const safe = `${user}__${branch}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
    const wt = path.join(this.worktreeBase, safe);
    if (fs.existsSync(path.join(wt, '.git'))) {
      await tryGit(wt, ['checkout', '--quiet', '--detach', commit]);
    } else {
      fs.mkdirSync(this.worktreeBase, { recursive: true });
      await tryGit(this.repoRoot, ['worktree', 'prune']);
      await git(this.repoRoot, ['worktree', 'add', '--quiet', '--detach', wt, commit]);
    }

    // Dev servers need dependencies. Borrow the root install when present.
    const rootModules = path.join(this.repoRoot, 'node_modules');
    const wtModules = path.join(wt, 'node_modules');
    if (fs.existsSync(rootModules) && !fs.existsSync(wtModules) && fs.existsSync(path.join(wt, 'package.json'))) {
      try { fs.symlinkSync(rootModules, wtModules, 'dir'); } catch { /* non fatal */ }
    }

    return this.start(key, { cwd: wt, commit, worktree: wt });
  }

  // Comments need to see inside the preview, so the dashboard never talks to
  // the dev server directly. Each preview gets a proxy that injects the
  // inspector script. If the proxy fails, fall back to the direct URL: the
  // preview still works, only element pinning degrades.
  attachProxy(rec, targetUrl) {
    if (rec.targetUrl) return;
    rec.targetUrl = targetUrl;
    startInjectingProxy(targetUrl)
      .then(({ server, url }) => {
        rec.proxyServer = server;
        rec.url = url;
        rec.status = 'ready';
      })
      .catch(() => {
        rec.url = targetUrl;
        rec.status = 'ready';
      });
  }

  record(key) {
    let rec = this.previews.get(key);
    if (!rec) {
      rec = { status: 'idle', url: null, log: '', proc: null };
      this.previews.set(key, rec);
    }
    return rec;
  }

  async start(key, { cwd, commit, worktree, own }) {
    const rec = this.record(key);
    rec.status = 'starting';
    rec.url = null;
    rec.targetUrl = null;
    if (rec.proxyServer) { try { rec.proxyServer.close(); } catch { /* gone */ } rec.proxyServer = null; }
    rec.error = null;
    rec.log = '';
    rec.commit = commit;
    rec.worktree = worktree || null;
    rec.own = !!own;
    rec.startedAt = Date.now();

    const cfg = this.previewConfig;
    if (!cfg) {
      rec.status = 'error';
      rec.error = 'no preview command configured for this repo.';
      return rec;
    }

    if (cfg.type === 'static') {
      const dir = path.resolve(cwd, cfg.dir || '.');
      const server = http.createServer((req, res) => serveStatic(dir, req, res));
      server.listen(0, '127.0.0.1', () => {
        this.attachProxy(rec, `http://localhost:${server.address().port}/`);
      });
      rec.server = server;
      return rec;
    }

    const port = await findFreePort(this.nextPort);
    this.nextPort = port + 1;
    const proc = spawn(cfg.command, {
      cwd,
      shell: true,
      detached: true,
      env: { ...process.env, PORT: String(port), BROWSER: 'none' },
    });
    rec.proc = proc;

    const onData = (buf) => {
      const text = stripAnsi(buf.toString());
      rec.log = (rec.log + text).slice(-8000);
      if (!rec.targetUrl) {
        const m = text.match(URL_RE);
        if (m) {
          const targetUrl = m[1].replace('0.0.0.0', 'localhost').replace('127.0.0.1', 'localhost');
          this.attachProxy(rec, targetUrl);
        }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (code) => {
      if (rec.status !== 'ready' || code !== 0) {
        rec.status = rec.status === 'ready' ? 'stopped' : 'error';
        if (rec.status === 'error') rec.error = `preview command exited with code ${code}.`;
      } else {
        rec.status = 'stopped';
      }
      rec.proc = null;
    });

    setTimeout(() => {
      if (rec.status === 'starting') {
        rec.status = 'error';
        rec.error = 'could not detect a preview URL from the command output.';
      }
    }, START_TIMEOUT_MS).unref();

    return rec;
  }

  stopAll() {
    for (const [, rec] of this.previews) {
      if (rec.proc && rec.proc.pid) {
        try { process.kill(-rec.proc.pid, 'SIGTERM'); } catch { /* gone */ }
      }
      if (rec.server) {
        try { rec.server.close(); } catch { /* gone */ }
      }
      if (rec.proxyServer) {
        try { rec.proxyServer.close(); } catch { /* gone */ }
      }
    }
  }
}

export function serveStatic(root, req, res) {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = path.normalize(path.join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404); res.end('not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(500); res.end('error');
  }
}
