/* design-share in-page inspector.
   Injected into previews by the daemon proxy. Draws the hover highlight and
   tooltip during comment mode, anchors pins to real elements, and talks to
   the dashboard through postMessage. Inert when not framed by the dashboard. */
(function () {
  'use strict';
  if (window.top === window || window.__designShareInspector) return;
  window.__designShareInspector = true;

  var Z = 2147483000;
  var commentMode = false;
  var comments = [];
  var focusedId = null;

  /* ---------- chrome (highlight box, tooltip, pin layer) ---------- */

  var css = [
    '.__ds-box{position:fixed;pointer-events:none;z-index:' + Z + ';border:1.5px solid #2f7cf6;',
    'border-radius:3px;background:rgba(47,124,246,0.06);display:none;box-sizing:border-box;}',
    '.__ds-tip{position:fixed;pointer-events:none;z-index:' + (Z + 2) + ';background:#16161a;color:#fff;',
    'font:12px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;padding:6px 10px;border-radius:7px;',
    'max-width:340px;box-shadow:0 4px 16px rgba(0,0,0,0.3);display:none;white-space:nowrap;',
    'overflow:hidden;text-overflow:ellipsis;}',
    '.__ds-tip b{font-weight:600;color:#9ec2ff;}',
    '.__ds-pin{position:fixed;z-index:' + (Z + 1) + ';width:20px;height:20px;border-radius:50% 50% 50% 0;',
    'transform:translate(-3px,-17px) rotate(-45deg);background:#2f7cf6;color:#fff;border:2px solid #fff;',
    'box-shadow:0 1px 4px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;',
    'font:600 10px -apple-system,sans-serif;cursor:pointer;}',
    '.__ds-pin>span{transform:rotate(45deg);}',
    '.__ds-pin.__ds-resolved{background:#2da562;opacity:0.55;}',
    '.__ds-pin.__ds-focused{outline:2px solid #2f7cf6;outline-offset:2px;}',
    '.__ds-comment-cursor,.__ds-comment-cursor *{cursor:crosshair !important;}',
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.documentElement.appendChild(style);

  var box = document.createElement('div');
  box.className = '__ds-box';
  var tip = document.createElement('div');
  tip.className = '__ds-tip';
  document.documentElement.appendChild(box);
  document.documentElement.appendChild(tip);
  var pinLayer = document.createElement('div');
  document.documentElement.appendChild(pinLayer);

  /* ---------- element naming, selectors ---------- */

  var FRIENDLY = {
    p: 'paragraph', a: 'link', img: 'image', button: 'button', input: 'input',
    textarea: 'input', select: 'input', ul: 'list', ol: 'list', li: 'list item',
    nav: 'navigation', svg: 'icon', video: 'video', form: 'form', table: 'table',
    label: 'label', header: 'header', footer: 'footer', section: 'section',
  };
  function friendlyName(el) {
    var t = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(t)) return 'heading';
    return FRIENDLY[t] || t;
  }

  function labelFor(el) {
    var name = friendlyName(el);
    var text = (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '')
      .replace(/\s+/g, ' ').trim();
    if (text.length > 42) text = text.slice(0, 42) + '…';
    return { name: name, text: text };
  }

  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
      var tag = node.tagName.toLowerCase();
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      var index = 1, sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === node.tagName) index++;
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')');
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function isOurs(el) {
    return el && el.className && typeof el.className === 'string' && el.className.indexOf('__ds-') !== -1;
  }

  /* ---------- hover highlight ---------- */

  var hoverEl = null;

  function showHighlight(el, x, y) {
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';

    var info = labelFor(el);
    tip.innerHTML = '<b>' + info.name + '</b>' + (info.text ? ': “' + escapeHtml(info.text) + '”' : '');
    tip.style.display = 'block';
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var tx = Math.min(Math.max(8, x + 12), window.innerWidth - tw - 8);
    var ty = y + 16 + th > window.innerHeight - 8 ? y - th - 10 : y + 16;
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';
  }

  function hideHighlight() {
    box.style.display = 'none';
    tip.style.display = 'none';
    hoverEl = null;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  document.addEventListener('mousemove', function (e) {
    if (!commentMode) return;
    var el = e.target;
    if (isOurs(el) || el === document.body || el === document.documentElement) { hideHighlight(); return; }
    hoverEl = el;
    showHighlight(el, e.clientX, e.clientY);
  }, true);

  document.addEventListener('mouseleave', hideHighlight, true);

  /* ---------- click to pin ---------- */

  ['click', 'mousedown', 'mouseup'].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!commentMode) return;
      if (isOurs(e.target)) return; // pins stay clickable
      e.preventDefault();
      e.stopPropagation();
      if (type !== 'click') return;
      var el = hoverEl || e.target;
      var r = el.getBoundingClientRect();
      var info = labelFor(el);
      parent.postMessage({
        ds: 'pin',
        selector: cssPath(el),
        elementLabel: info.name + (info.text ? ': “' + info.text + '”' : ''),
        relX: r.width ? (e.clientX - r.left) / r.width : 0.5,
        relY: r.height ? (e.clientY - r.top) / r.height : 0.5,
        xPct: (e.clientX / window.innerWidth) * 100,
        yPct: (e.clientY / window.innerHeight) * 100,
        clientX: e.clientX,
        clientY: e.clientY,
        route: location.pathname,
      }, '*');
      hideHighlight();
    }, true);
  });

  /* ---------- pins anchored to elements ---------- */

  function renderPins() {
    pinLayer.innerHTML = '';
    comments.forEach(function (c) {
      if (c.resolved && c.id !== focusedId) return;
      var x = null, y = null;
      var el = null;
      if (c.selector) {
        try { el = document.querySelector(c.selector); } catch (err) { el = null; }
      }
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.width || r.height) {
          x = r.left + (c.relX == null ? 0.5 : c.relX) * r.width;
          y = r.top + (c.relY == null ? 0.5 : c.relY) * r.height;
        }
      }
      if (x == null && c.xPct != null) {
        x = (c.xPct / 100) * window.innerWidth;
        y = (c.yPct / 100) * window.innerHeight;
      }
      if (x == null) return;
      var pin = document.createElement('div');
      pin.className = '__ds-pin' + (c.resolved ? ' __ds-resolved' : '') + (c.id === focusedId ? ' __ds-focused' : '');
      pin.style.left = x + 'px';
      pin.style.top = y + 'px';
      pin.innerHTML = '<span>' + c.n + '</span>';
      pin.addEventListener('click', function (e) {
        e.stopPropagation();
        parent.postMessage({ ds: 'pin-click', id: c.id }, '*');
      });
      pinLayer.appendChild(pin);
    });
  }

  var repaintQueued = false;
  function queueRepaint() {
    if (repaintQueued) return;
    repaintQueued = true;
    requestAnimationFrame(function () { repaintQueued = false; renderPins(); });
  }
  window.addEventListener('scroll', queueRepaint, true);
  window.addEventListener('resize', queueRepaint);
  setInterval(queueRepaint, 900);

  /* ---------- bridge ---------- */

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.ds === 'mode') {
      commentMode = !!d.comment;
      document.documentElement.classList.toggle('__ds-comment-cursor', commentMode);
      if (!commentMode) hideHighlight();
    } else if (d.ds === 'comments') {
      comments = d.items || [];
      focusedId = d.focusedId || null;
      renderPins();
    }
  });

  function announce() {
    parent.postMessage({ ds: 'ready', route: location.pathname }, '*');
  }
  announce();
  // The parent resets its bridge flag on iframe load, which fires after the
  // first announce. Announce again once the page is fully loaded.
  window.addEventListener('load', announce);
  window.addEventListener('popstate', announce);
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); announce(); };
})();
