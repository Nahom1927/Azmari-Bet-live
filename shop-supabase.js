/* Azmari Bet shop: Supabase adapter. Loads BEFORE shop-chat-location.js and stands in for the old server. */
(function () {
  'use strict';
  const SUPA_URL = 'https://YOUR-PROJECT.supabase.co';
  const SUPA_KEY = 'YOUR_PUBLISHABLE_KEY';
  if (!window.supabase || SUPA_URL.indexOf('__') === 0) { console.warn('Shop: Supabase is not configured'); return; }
  const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, { auth: { storageKey: 'azshop-auth', persistSession: true, autoRefreshToken: true } });
  const BASE = SUPA_URL.replace(/\/+$/, '') + '/storage/v1/object/public/shop';
  window.AZ_SHOP_API = BASE; // shop UI uses this as "API"; photo paths resolve against it
  const PER_PAGE = 24;

  const fail = (m, code) => { const e = new Error(m); e.status = code || 400; throw e; };
  function friendly(e) {
    const m = (e && e.message) || 'Error';
    if (/POST_LIMIT/.test(m)) return 'Free accounts can post 2 ads. Ask the admin to approve your seller account for unlimited ads.';
    if (/SELLER_BLOCKED/.test(m)) return 'Your seller account is blocked.';
    if ((e && e.code === '23505') || /duplicate key/.test(m)) return 'You already did this.';
    if (/row-level security/.test(m)) return 'Not allowed.';
    return m;
  }
  const ok = (r) => { if (r.error) fail(friendly(r.error), 400); return r.data; };
  async function me() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; }
  async function need() { const u = await me(); if (!u) fail('Please log in', 401); return u; }
  function normPhone(p) {
    let s = String(p || '').replace(/[\s\-()]/g, '');
    if (/^0\d{9}$/.test(s)) s = '+251' + s.slice(1); else if (/^251\d{9}$/.test(s)) s = '+' + s;
    if (!/^\+\d{9,15}$/.test(s)) fail('Enter a valid phone like +2519XXXXXXXX');
    return s;
  }
  const emailOf = (phone) => phone.slice(1) + '@azmari.app';

  async function route(path, opt) {
    const method = (opt.method || 'GET').toUpperCase();
    const u = new URL('http://x' + path);
    const [a, b, c] = u.pathname.replace(/^\/api/, '').split('/').filter(Boolean);
    const q = u.searchParams;
    const body = (opt.body && !(opt.body instanceof FormData)) ? JSON.parse(opt.body) : (opt.body || {});

    if (a === 'auth' && method === 'POST') {
      const phone = normPhone(body.phone); const pw = String(body.password || '');
      if (pw.length < 8) fail('Password must be 8+ characters');
      let r;
      if (b === 'register') {
        const name = String(body.name || '').trim();
        if (name.length < 2) fail('Please enter your full name');
        r = await sb.auth.signUp({ email: emailOf(phone), password: pw, options: { data: { name, phone } } });
        if (r.error) fail(/already/i.test(r.error.message) ? 'This phone is already registered. Log in instead.' : r.error.message);
        if (!r.data.session) fail('Turn OFF "Confirm email" in Supabase Authentication settings.');
      } else {
        r = await sb.auth.signInWithPassword({ email: emailOf(phone), password: pw });
        if (r.error) fail('Wrong phone or password', 401);
      }
      return { token: r.data.session.access_token };
    }
    if (a === 'me') {
      const usr = await need();
      const pr = ok(await sb.from('profiles').select('id,name,phone,role,seller_status').eq('id', usr.id).single());
      const cnt = await sb.from('listings').select('id', { count: 'exact', head: true }).eq('seller_id', usr.id).neq('status', 'rejected');
      const unlimited = pr.role === 'admin' || pr.seller_status === 'approved';
      return { user: pr, posts_used: cnt.count || 0, post_limit: unlimited ? null : 2 };
    }
    if (a === 'categories') return ok(await sb.from('categories').select('id,slug,name,icon').order('sort'));

    if (a === 'listings' && !b && method === 'GET') {
      const page = Math.max(1, parseInt(q.get('page'), 10) || 1);
      let qb = sb.from('listing_cards').select('*').order('id', { ascending: false })
        .range((page - 1) * PER_PAGE, (page - 1) * PER_PAGE + PER_PAGE);
      if (q.get('category')) qb = qb.eq('slug', q.get('category'));
      const term = (q.get('q') || '').slice(0, 60).replace(/[%_,()\\*]/g, ' ').trim();
      if (term) qb = qb.ilike('title', '%' + term + '%');
      const rows = ok(await qb);
      return { items: rows.slice(0, PER_PAGE).map((r) => Object.assign({}, r, { image: r.image ? '/' + r.image : null, verified: !!r.verified })), has_more: rows.length > PER_PAGE };
    }
    if (a === 'listings' && b && !c && method === 'GET') {
      const id = Number(b);
      const l = ok(await sb.from('listings').select('*').eq('id', id).maybeSingle());
      if (!l) fail('Ad not found', 404);
      const [cat, sp, im] = await Promise.all([
        sb.from('categories').select('name,icon').eq('id', l.category_id).single(),
        sb.from('public_profiles').select('name,seller_status').eq('id', l.seller_id).single(),
        sb.from('listing_images').select('path').eq('listing_id', id).order('sort')]);
      return Object.assign({}, l, {
        category: cat.data && cat.data.name, icon: cat.data && cat.data.icon,
        seller_name: sp.data && sp.data.name, verified: !!(sp.data && sp.data.seller_status === 'approved'),
        images: (im.data || []).map((r) => '/' + r.path) });
    }
    if (a === 'listings' && !b && method === 'POST') {
      const usr = await need(); const f = opt.body;
      const title = String(f.get('title') || '').trim(), city = String(f.get('city') || '').trim();
      const description = String(f.get('description') || '').trim(); const price = Number(f.get('price'));
      const cond = ['new', 'used', 'refurbished'].includes(f.get('condition')) ? f.get('condition') : 'used';
      const catId = Number(f.get('category_id'));
      if (title.length < 3 || title.length > 80) fail('Title must be 3 to 80 characters');
      if (city.length < 2) fail('Please enter your city / area');
      if (!Number.isFinite(price) || price < 0 || price > 1e9) fail('Enter a valid price');
      const files = f.getAll('images').filter((x) => x && x.size);
      if (files.length > 5 || files.some((x) => x.size > 3 * 1024 * 1024)) fail('Max 5 photos, 3 MB each');
      const lat = f.get('lat') != null ? Number(f.get('lat')) : null, lng = f.get('lng') != null ? Number(f.get('lng')) : null;
      const row = ok(await sb.from('listings').insert({ seller_id: usr.id, category_id: catId, title, description, price,
        item_condition: cond, city, lat, lng }).select('id,status').single());
      const exts = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
      for (let i = 0; i < files.length; i++) {
        const ext = exts[files[i].type]; if (!ext) continue;
        const path = usr.id + '/' + row.id + '-' + i + '-' + Date.now() + '.' + ext;
        const up = await sb.storage.from('shop').upload(path, files[i], { contentType: files[i].type });
        if (!up.error) await sb.from('listing_images').insert({ listing_id: row.id, path, sort: i });
      }
      return { id: row.id, status: row.status };
    }
    if (a === 'my' && b === 'listings') {
      const usr = await need();
      return ok(await sb.from('listings').select('id,title,price,status,is_sample').eq('seller_id', usr.id).order('id', { ascending: false }));
    }
    if (a === 'listings' && b && !c && method === 'DELETE') { await need(); ok(await sb.rpc('remove_listing', { lid: Number(b) })); return { ok: true }; }
    if (a === 'listings' && b && c === 'report' && method === 'POST') {
      const usr = await need();
      ok(await sb.from('reports').insert({ listing_id: Number(b), reporter_id: usr.id, reason: String(body.reason || '').slice(0, 200) }));
      return { ok: true };
    }
    if (a === 'admin' && b === 'overview') {
      await need();
      const pending = ok(await sb.from('listings').select('id,title,price,seller_id').eq('status', 'pending').order('id'));
      const reports = ok(await sb.from('reports').select('listing_id,reason,listings(title)').order('id', { ascending: false }).limit(30));
      const sellers = ok(await sb.from('profiles').select('id,name,phone,seller_status').eq('role', 'user').order('created_at', { ascending: false }).limit(100))
        .filter((s) => s.phone.indexOf('+2519000000') !== 0);
      const by = {}; sellers.forEach((s) => { by[s.id] = s; });
      return { sellers,
        listings: pending.map((l) => Object.assign({}, l, { seller_name: (by[l.seller_id] || {}).name || '', phone: (by[l.seller_id] || {}).phone || '' })),
        reports: reports.map((r) => ({ listing_id: r.listing_id, reason: r.reason, title: (r.listings || {}).title || 'Ad' })) };
    }
    if (a === 'admin' && b === 'listings' && c && method === 'PATCH') {
      if (!['approved', 'rejected', 'removed'].includes(body.status)) fail('Bad status');
      const d = ok(await sb.from('listings').update({ status: body.status }).eq('id', Number(c)).select('id'));
      if (!d.length) fail('Not allowed', 403); return { ok: true };
    }
    if (a === 'admin' && b === 'users' && c && method === 'PATCH') {
      if (!['approved', 'blocked', 'pending'].includes(body.seller_status)) fail('Bad status');
      const d = ok(await sb.from('profiles').update({ seller_status: body.seller_status }).eq('id', c).select('id'));
      if (!d.length) fail('Not allowed', 403); return { ok: true };
    }
    if (a === 'conversations') {
      await need();
      if (!b && method === 'GET') return ok(await sb.rpc('my_conversations'));
      if (!b && method === 'POST') return { id: ok(await sb.rpc('start_conversation', { lid: Number(body.listing_id) })) };
      if (b && c === 'messages') return ok(await sb.from('messages').select('id,conversation_id,sender_id,type,body,lat,lng,created_at').eq('conversation_id', Number(b)).order('id').limit(500));
    }
    return fail('Not found', 404);
  }

  // The shop UI calls fetch(API + '/api/...'): answer those from Supabase, pass everything else through.
  const realFetch = window.fetch.bind(window);
  const json = (st, d) => new Response(JSON.stringify(d), { status: st, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async function (url, opt) {
    const s = typeof url === 'string' ? url : ((url && url.url) || '');
    if (s.indexOf(BASE + '/api/') !== 0) return realFetch(url, opt);
    try { return json(200, await route(s.slice(BASE.length), opt || {})); }
    catch (e) { return json(e.status || 400, { error: friendly(e) }); }
  };
  // Shop logout just clears its token: also end the Supabase session on this device.
  const rm = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (k) { if (k === 'azshop_token') { sb.auth.signOut({ scope: 'local' }).catch(function () {}); } return rm.apply(this, arguments); };

  // socket.io replacement: chat messages + live location via Supabase Realtime (protected by the same RLS rules)
  async function emit(ev, d) {
    const usr = await need(); const cid = Number(d.conversation_id);
    if (ev === 'chat:send') {
      const text = String(d.body || '').trim().slice(0, 1000); if (!text) return;
      ok(await sb.from('messages').insert({ conversation_id: cid, sender_id: usr.id, type: 'text', body: text }));
    } else if (ev === 'chat:location') {
      const lat = Number(d.lat), lng = Number(d.lng); if (!isFinite(lat) || !isFinite(lng)) return;
      if (d.start) ok(await sb.from('messages').insert({ conversation_id: cid, sender_id: usr.id, type: 'location', body: '', lat, lng }));
      ok(await sb.from('live_locations').upsert({ conversation_id: cid, sender_id: usr.id, lat, lng, accuracy: Number(d.accuracy) || null, active: true, updated_at: new Date().toISOString() }));
    } else if (ev === 'chat:live-stop') {
      ok(await sb.from('live_locations').update({ active: false }).eq('conversation_id', cid).eq('sender_id', usr.id));
    }
  }
  window.io = function () {
    const handlers = {}; let chans = []; let dead = false;
    const fire = (ev, d) => (handlers[ev] || []).forEach((fn) => { try { fn(d); } catch (e) { console.error(e); } });
    (async () => {
      const usr = await me(); if (!usr || dead) return;
      const ch = sb.channel('azshop-' + usr.id + '-' + Date.now())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => fire('chat:message', p.new))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_locations' }, (p) => {
          const r = p.new; if (!r || r.sender_id === usr.id) return;
          if (r.active) fire('chat:live', { conversation_id: r.conversation_id, lat: r.lat, lng: r.lng, at: r.updated_at });
          else fire('chat:live-stop', { conversation_id: r.conversation_id });
        }).subscribe();
      chans.push(ch);
    })();
    return {
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
      disconnect() { dead = true; chans.forEach((c) => sb.removeChannel(c)); chans = []; },
      emit(ev, d, ack) { emit(ev, d).then(() => { if (ack) ack({}); }, (e) => { if (ack) ack({ error: friendly(e) }); }); },
    };
  };
})();
