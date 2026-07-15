import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { tryGit } from './git.js';
import { currentBranch } from './detect.js';
import { serveStatic } from './previews.js';
import { listOpenPRs } from './github.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SYNC_INTERVAL_MS = 15_000;
const FETCH_INTERVAL_MS = 60_000;

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

export class DesignShareServer {
  constructor({ repo, identity, store, previews, port }) {
    this.repo = repo;
    this.identity = identity;
    this.store = store;
    this.previews = previews;
    this.port = port;
    this.server = null;
    this.timers = [];
    this.prs = {};
  }

  async refreshPRs() {
    this.prs = await listOpenPRs(this.repo.root);
  }

  async branchHeads() {
    const heads = {};
    const raw = await tryGit(this.repo.root, [
      'for-each-ref', '--format=%(refname)%09%(objectname)%09%(committerdate:unix)%09%(authorname)',
      'refs/heads', 'refs/remotes/origin',
    ]);
    if (raw) {
      for (const line of raw.split('\n')) {
        const [ref, sha, time, author] = line.split('\t');
        if (!ref || ref.endsWith('/HEAD')) continue;
        const branch = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/origin\//, '');
        const isRemote = ref.startsWith('refs/remotes/');
        // Remote tip wins as the shared truth; local tip fills gaps.
        if (!heads[branch] || isRemote) {
          heads[branch] = { sha, time: Number(time) || 0, author: author || '' };
        }
      }
    }
    return heads;
  }

  async board() {
    const ownBranch = await currentBranch(this.repo.root);
    const ownHead = await tryGit(this.repo.root, ['rev-parse', 'HEAD']);
    const heads = await this.branchHeads();
    const state = this.store.state;
    const shares = Object.values(state.shares || {}).filter((s) => s.active);
    const sharedBranchSet = new Set(shares.map((s) => s.branch));
    const defaultish = new Set(['main', 'master', 'develop', 'dev']);
    const others = Object.entries(heads)
      .filter(([b]) => !sharedBranchSet.has(b) && !defaultish.has(b) && b !== ownBranch)
      .map(([branch, h]) => ({ branch, ...h }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 30);

    return {
      repo: { name: this.repo.name, remote: this.repo.remote, root: this.repo.root },
      me: this.identity,
      ownBranch,
      ownHead,
      port: this.port,
      shares,
      heads,
      otherBranches: others,
      comments: Object.values(state.comments || {}),
      users: Object.values(state.users || {}),
      requests: Object.values(state.requests || {}),
      previews: this.previews.statuses(),
      prs: this.prs,
      sync: {
        hasRemote: this.store.hasRemote,
        lastSync: this.store.lastSync,
        lastSyncError: this.store.lastSyncError,
      },
    };
  }

  async handle(req, res) {
    const url = new URL(req.url, `http://localhost:${this.port}`);
    const p = url.pathname;

    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'GET' && p === '/api/board') {
          return json(res, 200, await this.board());
        }
        if (req.method === 'POST' && p === '/api/share') {
          const body = await readBody(req);
          const branch = body.branch || (await currentBranch(this.repo.root));
          this.store.share({ branch, title: body.title });
          this.syncSoon();
          return json(res, 200, { ok: true, branch });
        }
        if (req.method === 'POST' && p === '/api/unshare') {
          const body = await readBody(req);
          this.store.unshare(body.branch);
          this.syncSoon();
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && p === '/api/comments') {
          const body = await readBody(req);
          const heads = await this.branchHeads();
          const ownBranch = await currentBranch(this.repo.root);
          let commit = heads[body.branch] ? heads[body.branch].sha : null;
          if (body.branch === ownBranch) {
            commit = await tryGit(this.repo.root, ['rev-parse', 'HEAD']);
          }
          const id = this.store.addComment({
            targetUser: body.targetUser,
            branch: body.branch,
            route: body.route || '/',
            xPct: body.xPct,
            yPct: body.yPct,
            selector: typeof body.selector === 'string' ? body.selector.slice(0, 500) : null,
            elementLabel: typeof body.elementLabel === 'string' ? body.elementLabel.slice(0, 200) : null,
            relX: typeof body.relX === 'number' ? body.relX : null,
            relY: typeof body.relY === 'number' ? body.relY : null,
            viewportLabel: body.viewportLabel || 'desktop',
            viewportW: body.viewportW,
            viewportH: body.viewportH,
            commit,
            text: String(body.text || '').slice(0, 4000),
          });
          this.store.autoResolveRequests(body.branch);
          this.syncSoon();
          return json(res, 200, { ok: true, id });
        }
        if (req.method === 'POST' && p === '/api/requests') {
          const body = await readBody(req);
          const id = this.store.requestReview({
            branch: String(body.branch || ''),
            toUser: String(body.toUser || ''),
            toName: String(body.toName || body.toUser || ''),
          });
          this.syncSoon();
          return json(res, 200, { ok: true, id });
        }
        const reqResolveMatch = p.match(/^\/api\/requests\/([a-z0-9]+)\/resolve$/);
        if (req.method === 'POST' && reqResolveMatch) {
          const body = await readBody(req);
          this.store.resolveRequest(reqResolveMatch[1], body.how);
          this.syncSoon();
          return json(res, 200, { ok: true });
        }
        const replyMatch = p.match(/^\/api\/comments\/([a-z0-9]+)\/replies$/);
        if (req.method === 'POST' && replyMatch) {
          const body = await readBody(req);
          this.store.reply(replyMatch[1], String(body.text || '').slice(0, 4000));
          this.syncSoon();
          return json(res, 200, { ok: true });
        }
        const resolveMatch = p.match(/^\/api\/comments\/([a-z0-9]+)\/resolve$/);
        if (req.method === 'POST' && resolveMatch) {
          const body = await readBody(req);
          this.store.setResolved(resolveMatch[1], body.resolved !== false);
          this.syncSoon();
          return json(res, 200, { ok: true });
        }
        if (req.method === 'POST' && p === '/api/preview/start') {
          const body = await readBody(req);
          const ownBranch = await currentBranch(this.repo.root);
          const rec = await this.previews.ensureBranch(body.user, body.branch, ownBranch);
          return json(res, 200, {
            ok: true,
            status: rec.status, url: rec.url, error: rec.error || null, logTail: rec.log ? rec.log.slice(-1600) : '',
          });
        }
        return json(res, 404, { error: 'not found' });
      }

      // Dashboard static files
      if (p === '/' || p === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')));
      }
      return serveStatic(PUBLIC_DIR, req, res);
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  syncSoon() {
    clearTimeout(this._syncSoonTimer);
    this._syncSoonTimer = setTimeout(() => this.store.sync(), 800);
  }

  listen() {
    return new Promise((resolve, reject) => {
      const attempt = (port, remaining) => {
        const server = http.createServer((req, res) => this.handle(req, res));
        server.once('error', (err) => {
          if (err.code === 'EADDRINUSE' && remaining > 0) {
            attempt(port + 1, remaining - 1);
          } else {
            reject(err);
          }
        });
        server.listen(port, '127.0.0.1', () => {
          this.port = port;
          this.server = server;
          this.timers.push(setInterval(() => this.store.sync(), SYNC_INTERVAL_MS));
          this.timers.push(setInterval(
            () => tryGit(this.repo.root, ['fetch', '--quiet', 'origin']),
            FETCH_INTERVAL_MS,
          ));
          this.refreshPRs();
          this.timers.push(setInterval(() => this.refreshPRs(), 180_000));
          resolve(port);
        });
      };
      attempt(this.port, 20);
    });
  }

  close() {
    this.timers.forEach(clearInterval);
    clearTimeout(this._syncSoonTimer);
    if (this.server) this.server.close();
    this.previews.stopAll();
  }
}
