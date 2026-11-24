/* Azmari Bet - Shop (Jiji-style posting), buyer/seller chat, live location.
   Self-contained: mounts only inside <div id="shop-root"> and uses its own CSS (css/shop.css). */
(function () {
  'use strict';
  // The app redraws its views with innerHTML, so #shop-root is created again every time the
  // Store tab is opened. We therefore mount (and re-mount) whenever a fresh #shop-root appears.
  const API = (window.AZ_SHOP_API || ((location.port === '4000' || location.port === '8080') ? location.origin : 'http://localhost:4000')).replace(/\/$/, '');
  const LIVE_MINUTES = 15;
  const S = { token: '', me: null, quota: null, cats: [], cat: '', q: '', page: 1,
              socket: null, chat: null, convs: [], watch: null, shareConv: 0, liveBox: null };
  try { S.token = localStorage.getItem('azshop_token') || ''; } catch (e) { /* private mode */ }
 
  // ---------- tiny helpers (DOM is built with textContent, never innerHTML => no XSS) ----------
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c); });
    return e;
  }
  const money = (n, cur) => (cur || 'ETB') + ' ' + Number(n).toLocaleString('en-US');
  const when = (iso) => new Date(iso);
  function ago(iso) {
    const s = Math.max(0, (Date.now() - when(iso)) / 1000);
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hours ago';
    return s < 172800 ? 'Yesterday' : Math.floor(s / 86400) + ' days ago';
  }
  const hhmm = (iso) => when(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function toast(msg) {
    const t = h('div', { class: 'azs azs-toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 3200);
  }
  async function api(path, opt) {
    opt = opt || {};
    const headers = {};
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    let body = opt.body;
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const r = await fetch(API + path, { method: opt.method || 'GET', headers, body });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Error ' + r.status);
    return d;
  }
  function modal(title, ...content) {
    const sheet = h('div', { class: 'azs-sheet', role: 'dialog', 'aria-label': title });
    const ov = h('div', { class: 'azs-overlay', onclick: (e) => { if (e.target === ov) close(); } }, sheet);
    const close = () => { ov.remove(); };
    sheet.append(h('h3', {}, title, h('button', { class: 'azs-x', 'aria-label': 'Close', onclick: close }, '\u00D7')), ...content);
    document.body.append(ov);
    return { sheet, close };
  }
 
  // ---------- map (Leaflet, loaded only when needed) ----------
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (!S.lp) {
      S.lp = new Promise((ok, no) => {
        const css = h('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
          integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', crossorigin: '' });
        const js = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
          integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', crossorigin: '',
          onload: ok, onerror: () => { S.lp = null; no(new Error('Map could not load')); } });
        document.head.append(css, js);
      });
    }
    return S.lp;
  }
  function mapBox(height) {
    const node = h('div', { class: 'azs-map', style: 'height:' + height + 'px' });
    let map = null; let dot = null;
    return {
      node,
      async set(lat, lng) {
        await loadLeaflet();
        if (!map) {
          map = L.map(node).setView([lat, lng], 15);
          L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
          dot = L.circleMarker([lat, lng], { radius: 9, color: '#1fc7f5', fillColor: '#1fc7f5', fillOpacity: 0.9 }).addTo(map);
        } else { dot.setLatLng([lat, lng]); map.panTo([lat, lng]); }
        setTimeout(() => map && map.invalidateSize(), 60);
      },
      destroy() { if (map) { map.remove(); map = null; } },
    };
  }
  function showMap(lat, lng, title) {
    const box = mapBox(300);
    const m = modal(title || 'Location', box.node,
      h('p', { class: 'azs-note' }, 'Lat ' + Number(lat).toFixed(5) + ', Lng ' + Number(lng).toFixed(5)));
    box.set(lat, lng).catch((e) => toast(e.message));
    const old = m.close; m.close = () => { box.destroy(); old(); };
  }
 
  // ---------- auth ----------
  async function refreshMe() {
    if (!S.token) { S.me = null; S.quota = null; return; }
    try {
      const d = await api('/api/me');
      S.me = d.user; S.quota = { used: d.posts_used, limit: d.post_limit };
      connectSocket();
    } catch (e) { S.token = ''; S.me = null; try { localStorage.removeItem('azshop_token'); } catch (x) { /* ignore */ } }
  }
  function needLogin(after) {
    const err = h('div', { class: 'azs-err' });
    let mode = 'login';
    const name = h('input', { class: 'azs-input', autocomplete: 'name', maxlength: 60 });
    const phone = h('input', { class: 'azs-input', type: 'tel', placeholder: '+2519XXXXXXXX', autocomplete: 'tel' });
    const pw = h('input', { class: 'azs-input', type: 'password', minlength: 8, autocomplete: 'current-password' });
    const nameField = h('label', { class: 'azs-field' }, 'Full name', name);
    nameField.style.display = 'none';
    const go = h('button', { class: 'azs-btn', onclick: submit }, 'Log in');
    const sw = h('button', { class: 'azs-link', onclick: toggle }, 'New here? Create an account');
    const m = modal('Log in', nameField, h('label', { class: 'azs-field' }, 'Phone', phone),
      h('label', { class: 'azs-field' }, 'Password (8+ characters)', pw), err, go, h('p', {}, sw));
    function toggle() {
      mode = mode === 'login' ? 'register' : 'login';
      nameField.style.display = mode === 'login' ? 'none' : 'block';
      go.textContent = mode === 'login' ? 'Log in' : 'Create account';
      sw.textContent = mode === 'login' ? 'New here? Create an account' : 'I already have an account';
    }
    async function submit() {
      err.textContent = ''; go.disabled = true;
      try {
        const d = await api('/api/auth/' + mode, { method: 'POST',
          body: { name: name.value, phone: phone.value, password: pw.value } });
        S.token = d.token;
        try { localStorage.setItem('azshop_token', d.token); } catch (e) { /* ignore */ }
        await refreshMe(); drawTop(); m.close();
        if (after) after();
      } catch (e) { err.textContent = e.message; } finally { go.disabled = false; }
    }
  }
  function logout() {
    stopShare();
    if (S.socket) { S.socket.disconnect(); S.socket = null; }
    S.token = ''; S.me = null; S.quota = null;
    try { localStorage.removeItem('azshop_token'); } catch (e) { /* ignore */ }
    drawTop();
  }
 
  // ---------- page ----------
  let ui = null;
  let timer;
  function buildPage(root) {
    ui = {
      actions: h('div', { class: 'azs-actions' }),
      search: h('input', { class: 'azs-search', type: 'search', placeholder: 'What are you looking for?',
        'aria-label': 'Search ads', value: S.q || '' }),
      cats: h('div', { class: 'azs-cats' }),
      grid: h('div', { class: 'azs-grid' }),
      more: h('button', { class: 'azs-btn azs-ghost azs-more', onclick: () => loadListings(false) }, 'Load more'),
    };
    root.classList.add('azs');
    root.textContent = '';
    root.append(h('div', { class: 'azs-top' }, h('h2', { class: 'azs-h' }, 'Store'), ui.actions),
      ui.search, ui.cats, h('p', { class: 'azs-sub' }, 'Fresh recommendations'), ui.grid, ui.more);
    ui.search.addEventListener('input', () => {
      clearTimeout(timer);
      const mine = ui;
      timer = setTimeout(() => { if (mine !== ui) return; S.q = mine.search.value.trim(); loadListings(true); }, 300);
    });
  }
 
  function drawTop() {
    if (!ui) return;
    ui.actions.textContent = '';
    ui.actions.append(h('button', { class: 'azs-btn', onclick: openPost }, '+ Sell'));
    if (S.me) {
      ui.actions.append(
        h('button', { class: 'azs-btn azs-ghost', onclick: openChats }, 'Chats'),
        h('button', { class: 'azs-btn azs-ghost', onclick: openMine }, 'My ads'));
      if (S.me.role === 'admin') ui.actions.append(h('button', { class: 'azs-btn azs-ghost', onclick: openAdmin }, 'Admin'));
      ui.actions.append(h('button', { class: 'azs-btn azs-ghost', onclick: logout }, 'Log out'));
    } else ui.actions.append(h('button', { class: 'azs-btn azs-ghost', onclick: () => needLogin() }, 'Log in'));
  }
  function drawCats() {
    if (!ui) return;
    ui.cats.textContent = '';
    const chip = (slug, icon, label) => h('button', { class: 'azs-chip' + (S.cat === slug ? ' on' : ''),
      onclick: () => { S.cat = slug; drawCats(); loadListings(true); } }, h('b', {}, icon), label);
    ui.cats.append(chip('', '\u2728', 'All'), ...S.cats.map((c) => chip(c.slug, c.icon, c.name)));
  }
  function card(l) {
    const media = h('div', { class: 'azs-media' },
      l.image ? h('img', { src: API + l.image, alt: l.title, loading: 'lazy' }) : h('span', { class: 'azs-emoji' }, l.icon));
    if (l.verified) media.append(h('span', { class: 'azs-badge' }, '\u2714 Verified'));
    return h('article', { class: 'azs-card', onclick: () => openDetail(l.id) }, media,
      h('div', { class: 'azs-body' },
        h('div', { class: 'azs-price' }, money(l.price, l.currency)),
        h('div', { class: 'azs-title' }, l.title),
        h('div', { class: 'azs-meta' }, '\u{1F4CD} ' + l.city),
        h('div', { class: 'azs-meta' }, '\u{1F552} ' + ago(l.created_at)),
        h('div', { class: 'azs-meta' }, '\u{1F464} ' + l.seller_name),
        h('div', { class: 'azs-row' },
          h('button', { class: 'azs-btn azs-contact', onclick: (e) => { e.stopPropagation(); contact(l.id); } }, 'Contact'),
          h('button', { class: 'azs-flag', title: 'Report this ad', 'aria-label': 'Report this ad',
            onclick: (e) => { e.stopPropagation(); report(l.id); } }, '\u2691'))));
  }
  async function loadListings(reset) {
    if (!ui) return;
    const mine = ui;
    if (reset) { S.page = 1; ui.grid.textContent = ''; }
    try {
      const qs = new URLSearchParams({ page: S.page });
      if (S.cat) qs.set('category', S.cat);
      if (S.q) qs.set('q', S.q);
      const d = await api('/api/listings?' + qs);
      if (mine !== ui) return; // the Store view was redrawn while loading
      d.items.forEach((l) => ui.grid.append(card(l)));
      if (reset && !d.items.length) ui.grid.append(h('p', { class: 'azs-empty' }, 'No ads found yet.'));
      ui.more.style.display = d.has_more ? 'block' : 'none';
      S.page += 1;
    } catch (e) {
      if (mine === ui) ui.grid.append(h('p', { class: 'azs-empty' }, 'Could not load ads. Is the shop server running?'));
    }
  }
 
  // ---------- ad detail / contact / report ----------
  async function openDetail(id) {
    try {
      const l = await api('/api/listings/' + id);
      const media = l.images.length
        ? h('div', { class: 'azs-gallery' }, l.images.map((p) => h('img', { src: API + p, alt: l.title })))
        : h('div', { class: 'azs-big' }, l.icon);
      const acts = h('div', { class: 'azs-row' });
      const m = modal(l.title, media,
        h('div', { class: 'azs-price' }, money(l.price, l.currency)),
        h('p', { class: 'azs-meta' }, [l.category, l.item_condition, l.city, ago(l.created_at), l.seller_name].join(' \u2022 ')),
        h('p', { class: 'azs-desc' }, l.description || 'No description.'), acts);
      acts.append(h('button', { class: 'azs-btn azs-contact', onclick: () => { m.close(); contact(l.id); } }, 'Chat with seller'));
      if (l.lat != null && l.lng != null) {
        acts.append(h('button', { class: 'azs-btn azs-ghost', onclick: () => showMap(l.lat, l.lng, l.city) }, '\u{1F4CD} Map'));
      }
    } catch (e) { toast(e.message); }
  }
  async function contact(listingId) {
    if (!S.me) return needLogin(() => contact(listingId));
    try {
      const c = await api('/api/conversations', { method: 'POST', body: { listing_id: listingId } });
      openChats(c.id);
    } catch (e) { toast(e.message); }
  }
  async function report(id) {
    if (!S.me) return needLogin(() => report(id));
    const reason = window.prompt('What is wrong with this ad?');
    if (!reason) return;
    try { await api('/api/listings/' + id + '/report', { method: 'POST', body: { reason } }); toast('Thanks, the admin will review it'); }
    catch (e) { toast(e.message); }
  }
 
  // ---------- post an ad (Jiji style: pick a category, then fill the form) ----------
  function openPost() {
    if (!S.me) return needLogin(openPost);
    const body = h('div');
    const m = modal('Post ad', body);
    const quota = S.quota && S.quota.limit != null
      ? 'Free account: ' + S.quota.used + ' of ' + S.quota.limit + ' ads used. The admin can approve your seller account for unlimited ads.'
      : 'Your seller account is approved: unlimited ads, published instantly.';
    body.append(h('p', { class: 'azs-note' }, quota), h('p', { class: 'azs-sub' }, 'Choose a category'),
      h('div', { class: 'azs-tiles' }, S.cats.map((c) =>
        h('button', { class: 'azs-tile', onclick: () => form(c) }, h('b', {}, c.icon), c.name))));
 
    function form(cat) {
      const err = h('div', { class: 'azs-err' });
      const f = {
        title: h('input', { class: 'azs-input', maxlength: 80 }),
        price: h('input', { class: 'azs-input', type: 'number', min: 0, step: 'any', inputmode: 'decimal' }),
        cond: h('select', { class: 'azs-input' }, ['used', 'new', 'refurbished'].map((v) => h('option', { value: v }, v))),
        city: h('input', { class: 'azs-input', maxlength: 60, placeholder: 'e.g. Bole, Addis Ababa' }),
        desc: h('textarea', { class: 'azs-input', maxlength: 2000 }),
        imgs: h('input', { class: 'azs-input', type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: '' }),
      };
      let pos = null;
      const where = h('small', {}, '');
      const send = h('button', { class: 'azs-btn', onclick: submit }, 'Submit ad');
      body.textContent = '';
      body.append(h('p', { class: 'azs-note' }, cat.icon + ' ' + cat.name),
        h('label', { class: 'azs-field' }, 'Title', f.title), h('label', { class: 'azs-field' }, 'Price (ETB)', f.price),
        h('label', { class: 'azs-field' }, 'Condition', f.cond), h('label', { class: 'azs-field' }, 'City / area', f.city),
        h('label', { class: 'azs-field' }, 'Description', f.desc),
        h('label', { class: 'azs-field' }, 'Photos (up to 5, 3 MB each)', f.imgs),
        h('button', { class: 'azs-btn azs-ghost', onclick: () => {
          navigator.geolocation.getCurrentPosition((p) => { pos = p.coords; where.textContent = ' Location added'; },
            () => toast('Location permission denied'), { enableHighAccuracy: true, timeout: 15000 });
        } }, '\u{1F4CD} Add my location'), where, err, h('div', { class: 'azs-row' }, send));
 
      async function submit() {
        err.textContent = '';
        const files = Array.from(f.imgs.files);
        if (files.length > 5 || files.some((x) => x.size > 3 * 1024 * 1024)) { err.textContent = 'Max 5 photos, 3 MB each'; return; }
        const fd = new FormData();
        fd.append('title', f.title.value); fd.append('price', f.price.value); fd.append('condition', f.cond.value);
        fd.append('city', f.city.value); fd.append('description', f.desc.value); fd.append('category_id', cat.id);
        if (pos) { fd.append('lat', pos.latitude); fd.append('lng', pos.longitude); }
        files.forEach((x) => fd.append('images', x));
        send.disabled = true;
        try {
          const d = await api('/api/listings', { method: 'POST', body: fd });
          m.close(); await refreshMe();
          toast(d.status === 'approved' ? 'Your ad is live!' : 'Submitted. It will appear after admin approval.');
          loadListings(true);
        } catch (e) { err.textContent = e.message; send.disabled = false; }
      }
    }
  }
  async function openMine() {
    try {
      const rows = await api('/api/my/listings');
      const m = modal('My ads', rows.length ? rows.map((r) => h('div', { class: 'azs-item' },
        h('div', {}, r.title, h('small', {}, money(r.price) + (r.is_sample ? ' \u2022 sample' : ''))),
        h('span', { class: 'azs-status' }, r.status),
        r.status === 'removed' ? '' : h('button', { class: 'azs-link', onclick: async () => {
          if (!window.confirm('Remove this ad?')) return;
          await api('/api/listings/' + r.id, { method: 'DELETE' }); m.close(); openMine(); loadListings(true);
        } }, 'Remove'))) : h('p', { class: 'azs-empty' }, 'You have no ads yet.'));
    } catch (e) { toast(e.message); }
  }
 
  // ---------- admin ----------
  async function openAdmin() {
    try {
      const d = await api('/api/admin/overview');
      const box = h('div');
      const m = modal('Admin', box);
      const act = (fn) => async () => { try { await fn(); m.close(); openAdmin(); loadListings(true); } catch (e) { toast(e.message); } };
      box.append(h('p', { class: 'azs-sub' }, 'Ads waiting for approval (' + d.listings.length + ')'),
        d.listings.map((l) => h('div', { class: 'azs-item' },
          h('div', {}, l.title, h('small', {}, money(l.price) + ' \u2022 ' + l.seller_name + ' ' + l.phone)),
          h('div', {},
            h('button', { class: 'azs-btn', onclick: act(() => api('/api/admin/listings/' + l.id, { method: 'PATCH', body: { status: 'approved' } })) }, 'Approve'), ' ',
            h('button', { class: 'azs-btn azs-danger', onclick: act(() => api('/api/admin/listings/' + l.id, { method: 'PATCH', body: { status: 'rejected' } })) }, 'Reject')))),
        h('p', { class: 'azs-sub' }, 'Sellers (approve = unlimited ads)'),
        d.sellers.map((u) => h('div', { class: 'azs-item' },
          h('div', {}, u.name, h('small', {}, u.phone + ' \u2022 ' + u.seller_status)),
          h('div', {},
            h('button', { class: 'azs-btn', onclick: act(() => api('/api/admin/users/' + u.id, { method: 'PATCH', body: { seller_status: 'approved' } })) }, 'Approve seller'), ' ',
            h('button', { class: 'azs-btn azs-danger', onclick: act(() => api('/api/admin/users/' + u.id, { method: 'PATCH', body: { seller_status: 'blocked' } })) }, 'Block')))),
        h('p', { class: 'azs-sub' }, 'Recent reports'),
        d.reports.map((r) => h('div', { class: 'azs-item' }, h('div', {}, r.title, h('small', {}, r.reason)),
          h('button', { class: 'azs-btn azs-danger', onclick: act(() => api('/api/admin/listings/' + r.listing_id, { method: 'PATCH', body: { status: 'removed' } })) }, 'Remove ad'))));
    } catch (e) { toast(e.message); }
  }
 
  // ---------- realtime ----------
  function loadSocketLib() {
    if (window.io) return Promise.resolve();
    if (!S.sp) {
      S.sp = new Promise((ok, no) => {
        document.head.append(h('script', { src: API + '/socket.io/socket.io.js', onload: ok,
          onerror: () => { S.sp = null; no(new Error('Chat server not reachable')); } }));
      });
    }
    return S.sp;
  }
  async function connectSocket() {
    if (S.socket || !S.token) return;
    try { await loadSocketLib(); } catch (e) { return; }
    if (S.socket) return;
    S.socket = window.io(API, { auth: { token: S.token } });
    S.socket.on('chat:message', (m) => {
      if (S.chat && S.chat.id === m.conversation_id) { addMsg(m); } else toast('New message');
      if (S.chat) loadConvs();
    });
    S.socket.on('chat:live', (d) => {
      if (S.chat && S.chat.id === d.conversation_id) showLive(d);
    });
    S.socket.on('chat:live-stop', (d) => {
      if (S.chat && S.chat.id === d.conversation_id) hideLive('Live location ended');
    });
  }
 
  // ---------- chat UI (responsive: 2 panes on desktop, 1 pane at a time on phones) ----------
  function openChats(convId) {
    if (!S.me) return needLogin(() => openChats(convId));
    connectSocket();
    if (S.chat && S.chat.ui) S.chat.ui.remove();
    const clist = h('div');
    const msgs = h('div', { class: 'azs-msgs' }, h('p', { class: 'azs-empty-thread' }, 'Select a chat'));
    const title = h('span', {}, 'Chat');
    const liveHolder = h('div');
    const input = h('input', { class: 'azs-input', maxlength: 1000, placeholder: 'Type a message', 'aria-label': 'Message' });
    const shareBtn = h('button', { class: 'azs-btn azs-ghost', title: 'Share live location', 'aria-label': 'Share live location', onclick: toggleShare }, '\u{1F4CD}');
    const sendBtn = h('button', { class: 'azs-btn', onclick: send }, 'Send');
    const wrap = h('div', { class: 'azs-chat' },
      h('div', { class: 'azs-clist' },
        h('div', { class: 'azs-chead' }, h('span', {}, 'My chats'),
          h('button', { class: 'azs-x', 'aria-label': 'Close chats', onclick: closeChats }, '\u00D7')), clist),
      h('div', { class: 'azs-thread' },
        h('div', { class: 'azs-chead' },
          h('button', { class: 'azs-ghost azs-btn azs-back', onclick: () => wrap.classList.remove('in-thread') }, '\u2190'),
          title, h('button', { class: 'azs-x', 'aria-label': 'Close chats', onclick: closeChats }, '\u00D7')),
        liveHolder, msgs, h('div', { class: 'azs-compose' }, shareBtn, input, sendBtn)));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    document.body.append(wrap);
    S.chat = { id: 0, ui: wrap, clist, msgs, title, liveHolder, input, shareBtn };
    loadConvs().then(() => { if (typeof convId === 'number') selectConv(convId); });
 
    function send() {
      const text = input.value.trim();
      if (!text || !S.chat.id || !S.socket) return;
      sendBtn.disabled = true;
      S.socket.emit('chat:send', { conversation_id: S.chat.id, body: text }, (r) => {
        sendBtn.disabled = false;
        if (r && r.error) toast(r.error); else input.value = '';
      });
    }
  }
  function closeChats() {
    stopShare(); hideLive();
    if (S.chat) { S.chat.ui.remove(); S.chat = null; }
  }
  async function loadConvs() {
    if (!S.chat) return;
    try {
      S.convs = await api('/api/conversations');
      S.chat.clist.textContent = '';
      if (!S.convs.length) S.chat.clist.append(h('p', { class: 'azs-empty' }, 'No chats yet. Tap Contact on an ad.'));
      S.convs.forEach((c) => S.chat.clist.append(h('div', { class: 'azs-conv' + (S.chat.id === c.id ? ' on' : ''),
        onclick: () => selectConv(c.id) }, h('b', {}, c.other_name), h('small', {}, c.title), h('small', {}, c.last_body || 'No messages yet'))));
    } catch (e) { toast(e.message); }
  }
  async function selectConv(id) {
    if (!S.chat) return;
    if (S.chat.id !== id) hideLive();
    S.chat.id = id;
    S.chat.ui.classList.add('in-thread');
    const c = S.convs.find((x) => x.id === id);
    S.chat.title.textContent = c ? c.other_name + ' \u2022 ' + c.title : 'Chat';
    S.chat.msgs.textContent = '';
    try {
      const list = await api('/api/conversations/' + id + '/messages');
      if (!S.chat || S.chat.id !== id) return;
      list.forEach(addMsg);
      if (!list.length) S.chat.msgs.append(h('p', { class: 'azs-empty-thread' }, 'Say hello \u{1F44B}'));
      loadConvs();
    } catch (e) { toast(e.message); }
  }
  function addMsg(m) {
    if (!S.chat) return;
    const first = S.chat.msgs.querySelector('.azs-empty-thread');
    if (first) first.remove();
    const mine = m.sender_id === S.me.id;
    const bubble = h('div', { class: 'azs-msg' + (mine ? ' me' : '') });
    if (m.type === 'location') {
      bubble.append(h('div', {}, '\u{1F4CD} Live location started'),
        h('button', { class: 'azs-link', onclick: () => showMap(m.lat, m.lng, 'Shared location') }, 'View start point'));
    } else bubble.append(m.body);
    bubble.append(h('time', {}, hhmm(m.created_at)));
    S.chat.msgs.append(bubble);
    S.chat.msgs.scrollTop = S.chat.msgs.scrollHeight;
  }
 
  // ---------- live location ----------
  function updateShareBtn() {
    if (!S.chat) return;
    const on = S.watch != null && S.shareConv === S.chat.id;
    S.chat.shareBtn.textContent = on ? '\u23F9 Stop' : '\u{1F4CD}';
    S.chat.shareBtn.title = on ? 'Stop sharing location' : 'Share live location';
  }
  function toggleShare() {
    if (S.watch != null) { stopShare(); return; }
    if (!S.chat || !S.chat.id) { toast('Open a chat first'); return; }
    if (!navigator.geolocation) { toast('Location is not supported on this device'); return; }
    if (!window.confirm('Share your live location with this person for ' + LIVE_MINUTES + ' minutes? You can stop any time.')) return;
    const cid = S.chat.id; let first = true; let last = 0;
    S.shareConv = cid;
    S.watch = navigator.geolocation.watchPosition((p) => {
      const now = Date.now();
      if (!first && now - last < 4000) return;
      last = now;
      S.socket.emit('chat:location', { conversation_id: cid, lat: p.coords.latitude, lng: p.coords.longitude,
        accuracy: p.coords.accuracy, start: first });
      first = false;
    }, (err) => { toast(err.code === 1 ? 'Location permission denied' : 'Could not get your location'); stopShare(); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    S.shareTimer = setTimeout(stopShare, LIVE_MINUTES * 60 * 1000);
    updateShareBtn();
    toast('Sharing live location');
  }
  function stopShare() {
    if (S.watch == null) return;
    navigator.geolocation.clearWatch(S.watch);
    S.watch = null; clearTimeout(S.shareTimer);
    if (S.socket && S.shareConv) S.socket.emit('chat:live-stop', { conversation_id: S.shareConv });
    S.shareConv = 0;
    updateShareBtn();
  }
  function showLive(d) {
    if (!S.chat) return;
    if (!S.liveBox) {
      S.liveBox = { box: mapBox(180), cap: h('span', {}, '') };
      S.chat.liveHolder.append(h('div', { class: 'azs-live' },
        h('p', {}, S.liveBox.cap, h('button', { class: 'azs-link', onclick: () => hideLive() }, 'Hide')), S.liveBox.box.node));
    }
    S.liveBox.cap.textContent = '\u{1F4CD} Live location \u2022 updated ' + new Date(d.at).toLocaleTimeString();
    S.liveBox.box.set(d.lat, d.lng).catch((e) => toast(e.message));
    clearTimeout(S.liveTimeout);
    S.liveTimeout = setTimeout(() => hideLive('Live location stopped updating'), 90000);
  }
  function hideLive(msg) {
    clearTimeout(S.liveTimeout);
    if (S.liveBox) { S.liveBox.box.destroy(); S.liveBox = null; }
    if (S.chat) S.chat.liveHolder.textContent = '';
    if (msg) toast(msg);
  }
 
  // ---------- start ----------
  async function mountStore(root) {
    buildPage(root);
    drawTop();
    if (!S.cats.length) { try { S.cats = await api('/api/categories'); } catch (e) { S.cats = []; } }
    drawCats();
    if (S.token && !S.me) await refreshMe();
    drawTop();
    loadListings(true);
  }
  function checkMount() {
    const root = document.getElementById('shop-root');
    if (root && root.dataset.azs !== '1') { root.dataset.azs = '1'; mountStore(root); }
  }
  new MutationObserver(checkMount).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', checkMount); else checkMount();
})();
