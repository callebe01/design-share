import crypto from 'node:crypto';
import { git, gitInput, tryGit } from './git.js';

const REF = 'refs/design-share/state';
const REMOTE_REF = 'refs/design-share/remote';

export function emptyState() {
  return { version: 1, shares: {}, comments: {}, users: {}, requests: {} };
}

export function newId() {
  return crypto.randomBytes(6).toString('hex');
}

function newer(a, b) {
  return (a.updatedAt || 0) >= (b.updatedAt || 0) ? a : b;
}

function mergeReplies(a = [], b = []) {
  const byId = new Map();
  for (const r of [...a, ...b]) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  return [...byId.values()].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0));
}

export function mergeStates(a, b) {
  if (!a) return b || emptyState();
  if (!b) return a;
  const out = emptyState();
  const shareKeys = new Set([...Object.keys(a.shares || {}), ...Object.keys(b.shares || {})]);
  for (const k of shareKeys) {
    const sa = (a.shares || {})[k];
    const sb = (b.shares || {})[k];
    out.shares[k] = sa && sb ? newer(sa, sb) : (sa || sb);
  }
  const commentKeys = new Set([...Object.keys(a.comments || {}), ...Object.keys(b.comments || {})]);
  for (const k of commentKeys) {
    const ca = (a.comments || {})[k];
    const cb = (b.comments || {})[k];
    if (ca && cb) {
      const win = newer(ca, cb);
      out.comments[k] = { ...win, replies: mergeReplies(ca.replies, cb.replies) };
    } else {
      out.comments[k] = ca || cb;
    }
  }
  const userKeys = new Set([...Object.keys(a.users || {}), ...Object.keys(b.users || {})]);
  for (const k of userKeys) {
    const ua = (a.users || {})[k];
    const ub = (b.users || {})[k];
    out.users[k] = ua && ub ? ((ua.lastSeen || 0) >= (ub.lastSeen || 0) ? ua : ub) : (ua || ub);
  }
  const reqKeys = new Set([...Object.keys(a.requests || {}), ...Object.keys(b.requests || {})]);
  for (const k of reqKeys) {
    const ra = (a.requests || {})[k];
    const rb = (b.requests || {})[k];
    out.requests[k] = ra && rb ? newer(ra, rb) : (ra || rb);
  }
  return out;
}

async function readRef(repoRoot, ref) {
  const raw = await tryGit(repoRoot, ['show', `${ref}:state.json`]);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export class StateStore {
  constructor(repoRoot, identity) {
    this.repoRoot = repoRoot;
    this.identity = identity;
    this.state = emptyState();
    this.hasRemote = false;
    this.lastSync = null;
    this.lastSyncError = null;
    this.dirty = false;
  }

  async init() {
    this.hasRemote = !!(await tryGit(this.repoRoot, ['remote', 'get-url', 'origin']));
    const local = await readRef(this.repoRoot, REF);
    if (local) this.state = mergeStates(this.state, local);
  }

  mutate(fn) {
    fn(this.state);
    this.dirty = true;
  }

  async writeRef() {
    const json = JSON.stringify(this.state, null, 2) + '\n';
    const blob = await gitInput(this.repoRoot, ['hash-object', '-w', '--stdin'], json);
    const tree = await gitInput(this.repoRoot, ['mktree'], `100644 blob ${blob}\tstate.json\n`);
    const parent = await tryGit(this.repoRoot, ['rev-parse', '--verify', '--quiet', REF]);
    const args = ['commit-tree', tree, '-m', 'design-share state'];
    if (parent) args.push('-p', parent);
    const env = {
      GIT_AUTHOR_NAME: this.identity.name || 'design-share',
      GIT_AUTHOR_EMAIL: this.identity.email || 'design-share@local',
      GIT_COMMITTER_NAME: this.identity.name || 'design-share',
      GIT_COMMITTER_EMAIL: this.identity.email || 'design-share@local',
    };
    const commit = await git(this.repoRoot, args, { env });
    await git(this.repoRoot, ['update-ref', REF, commit]);
  }

  // Presence: mark this user as someone who runs design-share so the
  // review request picker only offers reachable people. Throttled so it
  // does not force a push on every sync cycle.
  stampPresence() {
    const now = Date.now();
    const u = (this.state.users || {})[this.identity.slug];
    if (u && now - (u.lastSeen || 0) < 60 * 60 * 1000) return;
    this.mutate((s) => {
      s.users = s.users || {};
      s.users[this.identity.slug] = { user: this.identity.slug, name: this.identity.name, lastSeen: now };
    });
  }

  // Fetch remote state, merge, persist locally, push if anything moved.
  async sync() {
    this.stampPresence();
    try {
      let remoteState = null;
      if (this.hasRemote) {
        await tryGit(this.repoRoot, ['fetch', 'origin', `+${REF}:${REMOTE_REF}`]);
        remoteState = await readRef(this.repoRoot, REMOTE_REF);
      }
      const localRefState = await readRef(this.repoRoot, REF);
      const before = JSON.stringify(this.state);
      this.state = mergeStates(mergeStates(this.state, localRefState), remoteState);
      const changed = JSON.stringify(this.state) !== before;

      const refOutdated = JSON.stringify(localRefState) !== JSON.stringify(this.state);
      if (this.dirty || refOutdated) {
        await this.writeRef();
        this.dirty = false;
      }

      if (this.hasRemote) {
        const localSha = await tryGit(this.repoRoot, ['rev-parse', '--verify', '--quiet', REF]);
        const remoteSha = await tryGit(this.repoRoot, ['rev-parse', '--verify', '--quiet', REMOTE_REF]);
        if (localSha && localSha !== remoteSha) {
          // Histories on each machine advance independently, so a plain push
          // gets rejected as non fast forward. We merged content above, which
          // makes force safe apart from a small write race between teammates.
          await git(this.repoRoot, ['push', '--quiet', '--force', 'origin', `${REF}:${REF}`]);
        }
      }
      this.lastSync = Date.now();
      this.lastSyncError = null;
      return changed;
    } catch (err) {
      this.lastSyncError = err.message;
      return false;
    }
  }

  share({ branch, title }) {
    const key = `${this.identity.slug}/${branch}`;
    const now = Date.now();
    this.mutate((s) => {
      const existing = s.shares[key];
      s.shares[key] = {
        user: this.identity.slug,
        name: this.identity.name,
        email: this.identity.email,
        branch,
        title: title || (existing && existing.title) || branch,
        sharedAt: (existing && existing.sharedAt) || now,
        updatedAt: now,
        active: true,
      };
    });
  }

  unshare(branch) {
    const key = `${this.identity.slug}/${branch}`;
    this.mutate((s) => {
      if (s.shares[key]) {
        s.shares[key] = { ...s.shares[key], active: false, updatedAt: Date.now() };
      }
    });
  }

  addComment(data) {
    const id = newId();
    const now = Date.now();
    this.mutate((s) => {
      s.comments[id] = {
        id,
        user: this.identity.slug,
        name: this.identity.name,
        createdAt: now,
        updatedAt: now,
        replies: [],
        ...data,
      };
    });
    return id;
  }

  requestReview({ branch, toUser, toName }) {
    const id = newId();
    const now = Date.now();
    this.mutate((s) => {
      s.requests = s.requests || {};
      // One open request per branch per person: refresh an existing one.
      const existing = Object.values(s.requests).find(
        (r) => r.branch === branch && r.toUser === toUser && !r.resolvedAt,
      );
      const key = existing ? existing.id : id;
      s.requests[key] = {
        id: key,
        branch,
        fromUser: this.identity.slug,
        fromName: this.identity.name,
        toUser,
        toName,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        resolvedAt: null,
        resolvedBy: null,
      };
    });
    return id;
  }

  resolveRequest(requestId, how) {
    const now = Date.now();
    this.mutate((s) => {
      const r = (s.requests || {})[requestId];
      if (!r) return;
      r.resolvedAt = now;
      r.resolvedBy = this.identity.slug;
      r.resolvedHow = how || 'done';
      r.updatedAt = now;
    });
  }

  // A comment from the requested person is the review happening; close the loop.
  autoResolveRequests(branch) {
    const now = Date.now();
    this.mutate((s) => {
      for (const r of Object.values(s.requests || {})) {
        if (r.branch === branch && r.toUser === this.identity.slug && !r.resolvedAt) {
          r.resolvedAt = now;
          r.resolvedBy = this.identity.slug;
          r.resolvedHow = 'commented';
          r.updatedAt = now;
        }
      }
    });
  }

  reply(commentId, text) {
    const now = Date.now();
    this.mutate((s) => {
      const c = s.comments[commentId];
      if (!c) return;
      c.replies = [...(c.replies || []), {
        id: newId(),
        user: this.identity.slug,
        name: this.identity.name,
        text,
        createdAt: now,
      }];
      c.updatedAt = now;
    });
  }

  setResolved(commentId, resolved) {
    const now = Date.now();
    this.mutate((s) => {
      const c = s.comments[commentId];
      if (!c) return;
      c.resolvedAt = resolved ? now : null;
      c.resolvedBy = resolved ? this.identity.slug : null;
      c.updatedAt = now;
    });
  }
}
