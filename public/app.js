/* design-share dashboard */

const icons = {
  monitor: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>',
  tablet: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="12" x2="12.01" y1="18" y2="18"/></svg>',
  smartphone: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/></svg>',
  message: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  eye: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
};

/* ---------- PR panel (read only) ---------- */

function renderPrChip() {
  const chip = el('pr-chip');
  const sel = state.selected;
  const pr = sel && state.board.prs ? state.board.prs[sel.branch] : null;
  chip.hidden = !pr;
  if (pr) {
    const open = !el('pr-panel').hidden;
    chip.innerHTML = `PR #${pr.number} <span class="chev">${open ? '▴' : '▾'}</span>`;
    chip.title = pr.title || '';
  } else {
    el('pr-panel').hidden = true;
  }
}

async function togglePrPanel(force) {
  const panel = el('pr-panel');
  const show = force !== undefined ? force : panel.hidden;
  if (!show) { panel.hidden = true; renderPrChip(); return; }
  const sel = state.selected;
  if (!sel) return;
  panel.innerHTML = '<div class="pr-loading"><div class="spinner"></div></div>';
  panel.hidden = false;
  renderPrChip();
  const r = await fetch(`/api/pr?branch=${encodeURIComponent(sel.branch)}`).then((x) => x.json());
  if (panel.hidden) return; // closed while loading
  if (!r.pr) {
    panel.innerHTML = '<div class="pr-loading">Could not load the PR right now.</div>';
    return;
  }
  const pr = r.pr;
  const stateCls = pr.state === 'OPEN' ? 'live' : pr.state === 'MERGED' ? 'merged' : 'closed';
  panel.innerHTML = `
    <div class="pr-head">
      <span class="dot ${stateCls}"></span>
      <span class="pr-title">${escapeHtml(pr.title)}</span>
      <span class="pr-num">#${pr.number}</span>
      <a class="pr-open" href="${escapeHtml(pr.url)}" target="_blank" rel="noopener">Open on GitHub</a>
    </div>
    <div class="pr-byline">${escapeHtml(pr.author)} · ${escapeHtml(pr.state.toLowerCase())} · ${timeAgo(Date.parse(pr.createdAt) / 1000)}</div>
    ${pr.body ? `<div class="pr-body">${escapeHtml(pr.body)}</div>` : '<div class="pr-body dim-note">No description.</div>'}
    ${pr.comments.length ? `
      <div class="pr-comments-label">Comments (${pr.comments.length})</div>
      ${pr.comments.map((c) => `
        <div class="pr-comment">
          <div class="pr-comment-head">
            <span class="avatar">${escapeHtml((c.author || '?').slice(0, 1))}</span>
            <b>${escapeHtml(c.author)}</b>
            <span class="pr-comment-time">${timeAgo(Date.parse(c.createdAt) / 1000)}</span>
          </div>
          <div class="pr-comment-body">${escapeHtml(c.body)}</div>
        </div>`).join('')}` : '<div class="dim-note" style="margin-top:8px">No comments on the PR yet.</div>'}
  `;
}

/* ---------- review requests ---------- */

function branchRequests(branch) {
  if (!state.board) return [];
  return (state.board.requests || [])
    .filter((r) => r.branch === branch)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function openRequestForMe(branch) {
  const me = state.board.me.slug;
  return branchRequests(branch).find((r) => r.toUser === me && !r.resolvedAt);
}

function renderRequestButton() {
  const b = state.board;
  const sel = state.selected;
  const btn = el('btn-request');
  const roster = (b.users || []).filter((u) => u.user !== b.me.slug);
  const visible = !!sel && roster.length > 0;
  btn.hidden = !visible;
  if (visible) btn.innerHTML = `${icons.eye} <span>Request review</span>`;
}

function toggleRequestPopover(force) {
  const pop = el('request-popover');
  const show = force !== undefined ? force : pop.hidden;
  if (!show) { pop.hidden = true; return; }
  const b = state.board;
  const sel = state.selected;
  if (!sel) return;
  const roster = (b.users || [])
    .filter((u) => u.user !== b.me.slug)
    .sort((x, y) => (y.lastSeen || 0) - (x.lastSeen || 0));
  pop.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'popover-head';
  head.textContent = `Ask someone to review ${sel.branch}`;
  pop.appendChild(head);
  for (const u of roster) {
    const already = branchRequests(sel.branch).some((r) => r.toUser === u.user && !r.resolvedAt && r.fromUser === b.me.slug);
    const row = document.createElement('button');
    row.className = 'popover-row';
    row.innerHTML = `
      <span class="avatar">${escapeHtml((u.name || u.user).slice(0, 1))}</span>
      <span class="popover-name">${escapeHtml(u.name || u.user)}</span>
      <span class="popover-meta">${already ? 'asked' : timeAgo((u.lastSeen || 0) / 1000)}</span>`;
    row.disabled = already;
    row.onclick = async () => {
      await api('/api/requests', { branch: sel.branch, toUser: u.user, toName: u.name });
      toggleRequestPopover(false);
      toast(`Asked ${u.name || u.user} to review ${sel.branch}`);
      refresh();
    };
    pop.appendChild(row);
  }
  pop.hidden = false;
}

const el = (id) => document.getElementById(id);
const state = {
  board: null,
  selected: null,          // { user, branch }
  viewport: 'desktop',
  commentMode: false,
  pendingPin: null,        // { xPct, yPct, selector?, elementLabel?, relX?, relY?, route? }
  focusedComment: null,
  previewStatus: null,
  frameUrl: null,
  bridge: false,           // true when the injected inspector answered from inside the iframe
  route: '/',
  railFilter: '',
};

const VIEWPORTS = [
  { key: 'desktop', icon: 'monitor', title: 'Desktop' },
  { key: 'tablet', icon: 'tablet', title: 'Tablet · 834' },
  { key: 'mobile', icon: 'smartphone', title: 'Mobile · 390' },
];

function timeAgo(tsSeconds) {
  if (!tsSeconds) return '';
  const s = Math.max(1, Math.floor(Date.now() / 1000 - tsSeconds));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1800);
}

async function api(path, body) {
  const res = await fetch(path, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  return res.json();
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
}

function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'someone';
}

function branchComments(branch) {
  if (!state.board) return [];
  return state.board.comments
    .filter((c) => c.branch === branch)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function openCount(branch) {
  return branchComments(branch).filter((c) => !c.resolvedAt).length;
}

/* ---------- rail ---------- */

function renderRail() {
  const b = state.board;
  el('repo-name').textContent = b.repo.name;

  const sections = el('rail-sections');
  const frag = document.createDocumentFragment();
  const filter = (state.railFilter || '').trim().toLowerCase();

  // One section per person. Shared branches render bright; branches that
  // exist on origin without being shared render dim under the same author.
  const people = new Map(); // slug -> { slug, name, items: [{user, branch, time, shared}] }
  const person = (slug, name) => {
    if (!people.has(slug)) people.set(slug, { slug, name, items: [] });
    return people.get(slug);
  };

  const shares = b.shares.slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  for (const s of shares) {
    person(s.user, s.name).items.push({
      user: s.user, branch: s.branch, shared: true,
      time: b.heads[s.branch] ? b.heads[s.branch].time : s.updatedAt / 1000,
    });
  }
  for (const o of b.otherBranches) {
    const slug = slugify(o.author);
    person(slug, people.has(slug) ? people.get(slug).name : (o.author || 'someone'))
      .items.push({ user: slug, branch: o.branch, shared: false, time: o.time });
  }

  const me = people.get(b.me.slug);
  const ownShared = !!(me && me.items.some((i) => i.branch === b.ownBranch && i.shared));
  if (b.ownBranch && !ownShared) {
    const mine = person(b.me.slug, b.me.name);
    mine.items = mine.items.filter((i) => i.branch !== b.ownBranch);
    mine.items.unshift({
      user: b.me.slug, branch: b.ownBranch, shared: true, own: true,
      time: b.heads[b.ownBranch] ? b.heads[b.ownBranch].time : null,
    });
  }

  const latest = (p) => Math.max(...p.items.map((i) => i.time || 0), 0);
  const order = [...people.values()].sort((x, y) => {
    if (x.slug === b.me.slug) return -1;
    if (y.slug === b.me.slug) return 1;
    const xs = x.items.some((i) => i.shared), ys = y.items.some((i) => i.shared);
    if (xs !== ys) return xs ? -1 : 1;
    return latest(y) - latest(x);
  });

  let shown = 0;
  for (const p of order) {
    const items = p.items.filter((i) =>
      !filter || i.branch.toLowerCase().includes(filter) || p.name.toLowerCase().includes(filter));
    if (!items.length) continue;
    shown += items.length;

    const label = document.createElement('div');
    label.className = 'rail-section-label';
    label.textContent = p.slug === b.me.slug ? `${p.name} (you)` : p.name;
    frag.appendChild(label);
    for (const i of items) {
      frag.appendChild(branchRow({ user: i.user, branch: i.branch, time: i.time, dim: !i.shared }));
    }
    if (p.slug === b.me.slug && b.ownBranch && !ownShared && (!filter || b.ownBranch.toLowerCase().includes(filter))) {
      const cta = document.createElement('button');
      cta.className = 'share-cta';
      cta.innerHTML = `${icons.plus}  share ${escapeHtml(b.ownBranch)} with the board`;
      cta.onclick = async () => {
        await api('/api/share', { branch: b.ownBranch });
        toast('Shared with the team board');
        refresh();
      };
      frag.appendChild(cta);
    }
  }

  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'empty-note';
    empty.textContent = filter ? 'Nothing matches this filter.' : 'No branches yet.';
    frag.appendChild(empty);
  }

  sections.replaceChildren(frag);

  const sync = el('sync-status');
  if (!b.sync.hasRemote) {
    sync.innerHTML = '<span class="dot idle"></span> local only · no origin remote';
  } else if (b.sync.lastSyncError) {
    sync.innerHTML = '<span class="dot starting"></span> sync retrying…';
    sync.title = b.sync.lastSyncError;
  } else {
    sync.innerHTML = '<span class="dot live"></span> synced through git';
  }
}

function branchRow({ user, branch, time, dim, own }) {
  const b = state.board;
  const key = `${user}/${branch}`;
  const btn = document.createElement('button');
  btn.className = 'branch-row' + (dim ? ' dim' : '');
  const sel = state.selected;
  if (sel && sel.user === user && sel.branch === branch) btn.classList.add('selected');

  const prev = b.previews[key];
  const isOwnServing = own || (user === b.me.slug && branch === b.ownBranch);
  let dotCls = 'idle';
  if (prev && prev.status === 'ready') dotCls = 'live';
  else if (prev && prev.status === 'starting') dotCls = 'starting';
  else if (isOwnServing && prev && prev.status === 'ready') dotCls = 'live';

  const unresolved = openCount(branch);
  const pr = b.prs && b.prs[branch];
  const askedMe = openRequestForMe(branch);
  btn.innerHTML = `
    <span class="dot ${dotCls}"></span>
    <span class="branch-label">${escapeHtml(branch)}</span>
    ${askedMe ? `<span class="badge review" title="${escapeHtml((askedMe.fromName || askedMe.fromUser) + ' asked for your review')}">review</span>` : ''}
    ${unresolved ? `<span class="badge">${unresolved}</span>` : ''}
    ${pr ? `<span class="pr-link" title="${escapeHtml(`PR #${pr.number}: ${pr.title || ''}`)}">#${pr.number}</span>` : ''}
    <span class="meta">${timeAgo(time)}</span>`;
  btn.onclick = () => select(user, branch);
  if (pr) {
    btn.querySelector('.pr-link').onclick = (e) => {
      e.stopPropagation();
      window.open(pr.url, '_blank');
    };
  }
  return btn;
}

/* ---------- selection + preview ---------- */

async function select(user, branch) {
  state.selected = { user, branch };
  el('pr-panel').hidden = true;
  state.commentMode = false;
  state.pendingPin = null;
  state.focusedComment = null;
  state.frameUrl = null;
  state.bridge = false;
  location.hash = `#/u/${encodeURIComponent(user)}/${encodeURIComponent(branch)}`;
  el('frame').hidden = true;
  el('frame').src = 'about:blank';
  renderAll();
  pollPreview();
}

let previewPollToken = 0;
async function pollPreview() {
  const token = ++previewPollToken;
  const sel = state.selected;
  if (!sel) return;
  while (token === previewPollToken && state.selected === sel) {
    const r = await api('/api/preview/start', { user: sel.user, branch: sel.branch });
    if (token !== previewPollToken) return;
    state.previewStatus = r;
    renderStage();
    if (r.status === 'ready') return;
    if (r.status === 'error') return;
    await new Promise((ok) => setTimeout(ok, 1500));
  }
}

function renderStage() {
  const sel = state.selected;
  const b = state.board;
  const frame = el('frame');
  const wrap = el('frame-wrap');

  wrap.className = state.viewport === 'desktop' ? '' : `vw-${state.viewport}`;

  el('frame-empty').hidden = !!sel;
  const ps = state.previewStatus;

  if (!sel) {
    el('stage-title').textContent = 'pick a branch';
    el('stage-meta').textContent = '';
    el('frame-loading').hidden = true;
    el('frame-error').hidden = true;
    frame.hidden = true;
    renderPins();
    return;
  }

  const share = b.shares.find((s) => s.user === sel.user && s.branch === sel.branch);
  const authorName = share ? share.name
    : sel.user === b.me.slug ? b.me.name
    : (b.heads[sel.branch] && b.heads[sel.branch].author) || sel.user;
  const head = b.heads[sel.branch];
  el('stage-title').textContent = sel.branch;
  el('stage-meta').textContent = `${authorName}${head ? ' · updated ' + timeAgo(head.time) : ''}${sel.user === b.me.slug && sel.branch === b.ownBranch ? ' · your working copy' : ''}`;

  const loading = el('frame-loading');
  const error = el('frame-error');

  if (ps && ps.status === 'ready' && ps.url) {
    loading.hidden = true;
    error.hidden = true;
    if (state.frameUrl !== ps.url) {
      state.frameUrl = ps.url;
      frame.src = ps.url;
    }
    frame.hidden = false;
  } else if (ps && ps.status === 'error') {
    loading.hidden = true;
    error.hidden = false;
    frame.hidden = true;
    el('error-sub').textContent = ps.error || 'The preview process did not start.';
    el('error-log').textContent = (ps.logTail || '').trim();
  } else {
    loading.hidden = false;
    error.hidden = true;
    frame.hidden = true;
    const own = sel.user === b.me.slug && sel.branch === b.ownBranch;
    el('loading-title').textContent = own ? 'Starting your preview' : `Starting ${sel.branch}`;
    el('loading-sub').textContent = own
      ? 'Booting the dev server for your working copy.'
      : 'Checking the branch out into a hidden worktree and booting its preview. First open can take a moment.';
    el('loading-log').textContent = ps && ps.logTail ? ps.logTail.trim() : '';
  }

  renderRequestButton();
  renderPrChip();

  const cm = el('btn-comment-mode');
  cm.innerHTML = `${icons.message} <span>${state.commentMode ? 'Click an element to pin' : 'Comment'}</span>`;
  cm.classList.toggle('active-mode', state.commentMode);
  // The in-page inspector handles hover + capture when present; the overlay
  // only captures clicks as a fallback for previews the proxy could not reach.
  el('pin-layer').classList.toggle('capture', state.commentMode && !state.bridge);
  sendToFrame({ ds: 'mode', comment: state.commentMode });

  renderPins();
}

function sendToFrame(msg) {
  const frame = el('frame');
  if (frame.contentWindow) {
    try { frame.contentWindow.postMessage(msg, '*'); } catch { /* not ready */ }
  }
}

function pushCommentsToFrame() {
  const sel = state.selected;
  if (!sel || !state.bridge) return;
  const items = branchComments(sel.branch).map((c, i) => ({
    id: c.id,
    n: i + 1,
    selector: c.selector || null,
    relX: c.relX,
    relY: c.relY,
    xPct: c.xPct,
    yPct: c.yPct,
    resolved: !!c.resolvedAt,
  }));
  sendToFrame({ ds: 'comments', items, focusedId: state.focusedComment });
}

window.addEventListener('message', (e) => {
  const frame = el('frame');
  if (e.source !== frame.contentWindow) return;
  const d = e.data || {};
  if (d.ds === 'ready') {
    state.bridge = true;
    state.route = d.route || '/';
    sendToFrame({ ds: 'mode', comment: state.commentMode });
    pushCommentsToFrame();
    renderStage();
  } else if (d.ds === 'pin') {
    state.pendingPin = {
      xPct: d.xPct, yPct: d.yPct,
      selector: d.selector, elementLabel: d.elementLabel,
      relX: d.relX, relY: d.relY, route: d.route,
    };
    const composer = el('composer');
    composer.hidden = false;
    const wrap = el('frame-wrap');
    composer.style.left = Math.min(d.clientX, wrap.clientWidth - 260) + 'px';
    composer.style.top = Math.min(d.clientY + 14, wrap.clientHeight - 120) + 'px';
    el('composer-text').value = '';
    el('composer-text').focus();
  } else if (d.ds === 'pin-click') {
    state.focusedComment = state.focusedComment === d.id ? null : d.id;
    renderComments();
    pushCommentsToFrame();
    if (state.focusedComment) {
      const card = document.querySelector(`[data-comment="${d.id}"]`);
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

/* ---------- pins ---------- */

function renderPins() {
  const layer = el('pin-layer');
  layer.querySelectorAll('.pin').forEach((p) => p.remove());
  const sel = state.selected;
  if (state.bridge) { pushCommentsToFrame(); return; }
  if (!sel || el('frame').hidden) return;
  const comments = branchComments(sel.branch);
  comments.forEach((c, i) => {
    if (c.resolvedAt && state.focusedComment !== c.id) return;
    if (c.xPct == null) return;
    const pin = document.createElement('div');
    pin.className = 'pin' + (c.resolvedAt ? ' resolved' : '') + (state.focusedComment === c.id ? ' focused' : '');
    pin.style.left = c.xPct + '%';
    pin.style.top = c.yPct + '%';
    pin.innerHTML = `<span>${i + 1}</span>`;
    pin.onclick = (e) => {
      e.stopPropagation();
      state.focusedComment = c.id;
      renderComments();
      renderPins();
      const card = document.querySelector(`[data-comment="${c.id}"]`);
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    layer.appendChild(pin);
  });
}

el('pin-layer').addEventListener('click', (e) => {
  if (!state.commentMode || !state.selected) return;
  const rect = el('pin-layer').getBoundingClientRect();
  const xPct = ((e.clientX - rect.left) / rect.width) * 100;
  const yPct = ((e.clientY - rect.top) / rect.height) * 100;
  state.pendingPin = { xPct, yPct };
  const composer = el('composer');
  composer.hidden = false;
  composer.style.left = Math.min(xPct, 72) + '%';
  composer.style.top = Math.min(yPct + 2, 80) + '%';
  el('composer-text').value = '';
  el('composer-text').focus();
});

async function postComment() {
  const text = el('composer-text').value.trim();
  const sel = state.selected;
  if (!text || !sel || !state.pendingPin) return;
  const rect = el('pin-layer').getBoundingClientRect();
  const pin = state.pendingPin;
  await api('/api/comments', {
    targetUser: sel.user,
    branch: sel.branch,
    route: pin.route || state.route || '/',
    xPct: pin.xPct,
    yPct: pin.yPct,
    selector: pin.selector || null,
    elementLabel: pin.elementLabel || null,
    relX: pin.relX,
    relY: pin.relY,
    viewportLabel: state.viewport,
    viewportW: Math.round(rect.width),
    viewportH: Math.round(rect.height),
    text,
  });
  closeComposer();
  state.commentMode = false;
  await refresh();
  toast('Pinned. The author will see it on their board.');
}

function closeComposer() {
  el('composer').hidden = true;
  state.pendingPin = null;
}

el('composer-post').onclick = postComment;
el('composer-cancel').onclick = () => { closeComposer(); };
el('composer-text').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') postComment();
  if (e.key === 'Escape') closeComposer();
});

/* ---------- comments panel ---------- */

function renderComments() {
  const sel = state.selected;
  const list = el('comments-list');
  if (!sel) {
    el('comments-count').textContent = '';
    list.innerHTML = '<div class="empty-note">Comments for the selected branch land here, pinned to the exact spot and commit.</div>';
    return;
  }
  const comments = branchComments(sel.branch);
  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);
  el('comments-count').textContent = open.length ? `${open.length} open` : '';

  const frag = document.createDocumentFragment();

  const me = state.board.me.slug;
  for (const r of branchRequests(sel.branch).filter((x) => !x.resolvedAt)) {
    const card = document.createElement('div');
    card.className = 'request-card' + (r.toUser === me ? ' for-me' : '');
    if (r.toUser === me) {
      card.innerHTML = `<span class="request-text"><b>${escapeHtml(r.fromName || r.fromUser)}</b> asked for your review</span>
        <span class="request-meta">${timeAgo(r.createdAt / 1000)}</span>`;
      const done = document.createElement('button');
      done.className = 'btn small';
      done.textContent = 'Mark reviewed';
      done.onclick = async () => { await api(`/api/requests/${r.id}/resolve`, { how: 'done' }); refresh(); };
      card.appendChild(done);
    } else if (r.fromUser === me) {
      card.innerHTML = `<span class="request-text">You asked <b>${escapeHtml(r.toName || r.toUser)}</b> to review</span>
        <span class="request-meta">${timeAgo(r.createdAt / 1000)}</span>`;
      const cancel = document.createElement('button');
      cancel.className = 'link-btn';
      cancel.textContent = 'Cancel';
      cancel.onclick = async () => { await api(`/api/requests/${r.id}/resolve`, { how: 'cancelled' }); refresh(); };
      card.appendChild(cancel);
    } else {
      card.innerHTML = `<span class="request-text"><b>${escapeHtml(r.fromName || r.fromUser)}</b> asked <b>${escapeHtml(r.toName || r.toUser)}</b> to review</span>
        <span class="request-meta">${timeAgo(r.createdAt / 1000)}</span>`;
    }
    frag.appendChild(card);
  }

  if (!comments.length) {
    const d = document.createElement('div');
    d.className = 'empty-note';
    d.textContent = 'No comments yet. Use Comment, then click anywhere on the preview to pin one.';
    frag.appendChild(d);
  }
  comments.forEach((c, i) => {
    if (!c.resolvedAt) frag.appendChild(commentCard(c, i + 1));
  });
  if (resolved.length) {
    const note = document.createElement('div');
    note.className = 'section-note';
    note.textContent = `resolved (${resolved.length})`;
    frag.appendChild(note);
    comments.forEach((c, i) => {
      if (c.resolvedAt) frag.appendChild(commentCard(c, i + 1));
    });
  }
  list.replaceChildren(frag);
}

function commentCard(c, num) {
  const b = state.board;
  const card = document.createElement('div');
  card.className = 'comment-card' + (c.resolvedAt ? ' resolved' : '') + (state.focusedComment === c.id ? ' focused' : '');
  card.dataset.comment = c.id;

  const head = b.heads[c.branch];
  const changed = head && c.commit && head.sha !== c.commit;
  const initials = (c.name || c.user || '?').slice(0, 1);

  card.innerHTML = `
    <div class="comment-head">
      <span class="avatar">${escapeHtml(initials)}</span>
      <span class="comment-author">${escapeHtml(c.name || c.user)}</span>
      <span class="comment-num">${num}</span>
    </div>
    <div class="comment-text">${escapeHtml(c.text)}</div>
    ${c.elementLabel ? `<div class="comment-anchor">${escapeHtml(c.elementLabel)}</div>` : ''}
    <div class="comment-meta">
      <span>${timeAgo(c.createdAt / 1000)}</span>
      ${c.viewportLabel ? `<span>· ${escapeHtml(c.viewportLabel)}</span>` : ''}
      ${c.commit ? `<span>· ${escapeHtml(c.commit.slice(0, 7))}</span>` : ''}
      ${changed && !c.resolvedAt ? '<span class="chip changed"><span class="dot starting"></span>updated since pin</span>' : ''}
      ${c.resolvedAt ? `<span class="chip">${icons.check} resolved</span>` : ''}
    </div>
    ${(c.replies || []).length ? `<div class="comment-replies">${c.replies.map((r) => `<div class="reply"><b>${escapeHtml(r.name || r.user)}</b> ${escapeHtml(r.text)}</div>`).join('')}</div>` : ''}
  `;

  const actions = document.createElement('div');
  actions.className = 'comment-actions';
  if (!c.resolvedAt) {
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'link-btn resolve';
    resolveBtn.textContent = changed ? 'Mark fixed' : 'Resolve';
    resolveBtn.onclick = async () => { await api(`/api/comments/${c.id}/resolve`, { resolved: true }); refresh(); };
    actions.appendChild(resolveBtn);
  } else {
    const reopenBtn = document.createElement('button');
    reopenBtn.className = 'link-btn';
    reopenBtn.textContent = 'Reopen';
    reopenBtn.onclick = async () => { await api(`/api/comments/${c.id}/resolve`, { resolved: false }); refresh(); };
    actions.appendChild(reopenBtn);
  }
  card.appendChild(actions);

  const reply = document.createElement('input');
  reply.className = 'reply-input';
  reply.placeholder = 'Reply…';
  reply.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && reply.value.trim()) {
      await api(`/api/comments/${c.id}/replies`, { text: reply.value.trim() });
      reply.value = '';
      refresh();
    }
  });
  card.appendChild(reply);

  card.onclick = (e) => {
    if (e.target === reply || e.target.tagName === 'BUTTON') return;
    state.focusedComment = state.focusedComment === c.id ? null : c.id;
    renderComments();
    renderPins();
    pushCommentsToFrame();
  };
  return card;
}

/* ---------- header controls ---------- */

function renderViewportSeg() {
  const seg = el('viewport-seg');
  seg.innerHTML = '';
  for (const v of VIEWPORTS) {
    const btn = document.createElement('button');
    btn.innerHTML = icons[v.icon];
    btn.title = v.title;
    btn.className = state.viewport === v.key ? 'active' : '';
    btn.onclick = () => { state.viewport = v.key; renderViewportSeg(); renderStage(); };
    seg.appendChild(btn);
  }
}

el('btn-comment-mode').onclick = () => {
  if (!state.selected || el('frame').hidden) { toast('Open a preview first'); return; }
  state.commentMode = !state.commentMode;
  if (!state.commentMode) closeComposer();
  renderStage();
};

el('btn-retry').onclick = () => pollPreview();

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!el('composer').hidden) closeComposer();
    else if (!el('pr-panel').hidden) togglePrPanel(false);
    else if (state.commentMode) { state.commentMode = false; renderStage(); }
    else if (state.focusedComment) {
      state.focusedComment = null;
      renderComments();
      renderPins();
      pushCommentsToFrame();
    }
  }
});

/* ---------- boot + polling ---------- */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderAll() {
  if (!state.board) return;
  renderRail();
  renderStage();
  renderComments();
}

async function refresh() {
  try {
    const board = await fetch('/api/board').then((r) => r.json());
    state.board = board;
    if (!isTyping() && el('composer').hidden) {
      renderAll();
    } else {
      renderStage();
    }
  } catch { /* server restarting */ }
}

function parseHash() {
  const m = location.hash.match(/^#\/u\/([^/]+)\/(.+)$/);
  if (m) return { user: decodeURIComponent(m[1]), branch: decodeURIComponent(m[2]) };
  return null;
}

(async function boot() {
  // Each iframe navigation starts a fresh document; assume no inspector until
  // the injected script announces itself again.
  el('frame').addEventListener('load', () => {
    state.bridge = false;
    setTimeout(() => renderStage(), 300);
  });
  el('branch-filter').addEventListener('input', (e) => {
    state.railFilter = e.target.value;
    renderRail();
  });
  el('btn-request').onclick = (e) => { e.stopPropagation(); toggleRequestPopover(); };
  el('pr-chip').onclick = (e) => { e.stopPropagation(); togglePrPanel(); };
  document.addEventListener('click', (e) => {
    if (!el('request-popover').hidden && !e.target.closest('.request-wrap')) toggleRequestPopover(false);
    if (!el('pr-panel').hidden && !e.target.closest('#pr-panel') && !e.target.closest('#pr-chip')) togglePrPanel(false);
  });
  renderViewportSeg();
  await refresh();
  const target = parseHash();
  if (target) {
    select(target.user, target.branch);
  } else if (state.board && state.board.ownBranch) {
    select(state.board.me.slug, state.board.ownBranch);
  }
  setInterval(refresh, 3000);
})();
