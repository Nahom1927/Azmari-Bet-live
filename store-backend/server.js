'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
 
// ---------- config ----------
const PORT = Number(process.env.PORT) || 8080;
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is missing or shorter than 32 characters. Check .env');
  process.exit(1);
}
const ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:8080,http://localhost:8080')
  .split(',').map((s) => s.trim()).filter(Boolean);
const FREE_POST_LIMIT = 2; // keep in sync with trigger trg_post_limit in schema.sql
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
 
const db = new Database(process.env.DB_FILE || path.join(__dirname, 'shop.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
 
// ---------- app ----------
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: ORIGINS }));
app.use(express.json({ limit: '50kb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'www'))); // serves your app at http://localhost:8080,http://localhost:8080
 
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));
 
// ---------- helpers ----------
const str = (v, min, max) => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
};
const normPhone = (v) => {
  if (typeof v !== 'string') return null;
  const p = v.replace(/[\s-]/g, '');
  return /^\+?[0-9]{9,15}$/.test(p) ? p : null;
};
const numOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const sign = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '14d' });
const getUser = db.prepare('SELECT id, name, role, seller_status FROM users WHERE id = ?');
 
function readToken(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
function auth(req, res, next) {
  try {
    const p = jwt.verify(readToken(req), JWT_SECRET);
    const u = getUser.get(p.id);
    if (!u) throw new Error('no user');
    req.user = u;
    next();
  } catch (e) {
    res.status(401).json({ error: 'Please log in' });
  }
}
function tryAuth(req, res, next) {
  try {
    const p = jwt.verify(readToken(req), JWT_SECRET);
    req.user = getUser.get(p.id) || null;
  } catch (e) { req.user = null; }
  next();
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });
const isUnlimited = (u) => u.role === 'admin' || u.seller_status === 'approved';
 
// ---------- uploads ----------
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[f.mimetype]),
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 5 },
  fileFilter: (req, f, cb) => cb(null, Boolean(EXT[f.mimetype])),
});
function looksLikeImage(file) { // check the real file header, not only the browser's claim
  const b = Buffer.alloc(12);
  const fd = fs.openSync(file.path, 'r');
  fs.readSync(fd, b, 0, 12, 0);
  fs.closeSync(fd);
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const webp = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
  return jpg || png || webp;
}
 
// ---------- auth routes ----------
app.post('/api/auth/register', authLimiter, async (req, res) => {
  const name = str(req.body.name, 2, 60);
  const phone = normPhone(req.body.phone);
  const pw = req.body.password;
  if (!name || !phone || typeof pw !== 'string' || pw.length < 8 || pw.length > 72) {
    return res.status(400).json({ error: 'Enter your name, a valid phone (+251...) and a password of 8-72 characters' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) {
    return res.status(409).json({ error: 'This phone number is already registered' });
  }
  const hash = await bcrypt.hash(pw, 10);
  const info = db.prepare('INSERT INTO users (name, phone, password_hash) VALUES (?, ?, ?)').run(name, phone, hash);
  res.json({ token: sign(info.lastInsertRowid) });
});
 
app.post('/api/auth/login', authLimiter, async (req, res) => {
  const phone = normPhone(req.body.phone);
  const pw = req.body.password;
  const row = phone && db.prepare('SELECT id, password_hash FROM users WHERE phone = ?').get(phone);
  const ok = row && typeof pw === 'string' && (await bcrypt.compare(pw, row.password_hash));
  if (!ok) return res.status(401).json({ error: 'Wrong phone or password' });
  res.json({ token: sign(row.id) });
});
 
app.get('/api/me', auth, (req, res) => {
  const used = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE seller_id = ? AND status <> 'rejected'").get(req.user.id).n;
  res.json({ user: req.user, posts_used: used, post_limit: isUnlimited(req.user) ? null : FREE_POST_LIMIT });
});
 
// ---------- listings ----------
app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT id, slug, name, icon FROM categories ORDER BY sort').all());
});
 
app.get('/api/listings', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const cat = typeof req.query.category === 'string' && req.query.category ? req.query.category : null;
  const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim().slice(0, 60) : null;
  const rows = db.prepare(`
    SELECT l.id, l.title, l.price, l.currency, l.city, l.created_at, c.icon,
           u.name AS seller_name, (u.seller_status = 'approved') AS verified,
           (SELECT path FROM listing_images i WHERE i.listing_id = l.id ORDER BY sort LIMIT 1) AS image
      FROM listings l
      JOIN categories c ON c.id = l.category_id
      JOIN users u ON u.id = l.seller_id
     WHERE l.status = 'approved'
       AND (@cat IS NULL OR c.slug = @cat)
       AND (@q IS NULL OR l.title LIKE @like)
     ORDER BY l.id DESC LIMIT 25 OFFSET @off`)
    .all({ cat, q, like: q ? `%${q}%` : null, off: (page - 1) * 24 });
  res.json({ items: rows.slice(0, 24).map((r) => ({ ...r, verified: !!r.verified })), has_more: rows.length > 24 });
});
 
app.get('/api/listings/:id', tryAuth, (req, res) => {
  const l = db.prepare(`
    SELECT l.*, c.name AS category, c.icon, u.name AS seller_name,
           (u.seller_status = 'approved') AS verified
      FROM listings l JOIN categories c ON c.id = l.category_id JOIN users u ON u.id = l.seller_id
     WHERE l.id = ?`).get(Number(req.params.id));
  const mine = l && req.user && (req.user.id === l.seller_id || req.user.role === 'admin');
  if (!l || (l.status !== 'approved' && !mine)) return res.status(404).json({ error: 'Ad not found' });
  l.verified = !!l.verified;
  l.images = db.prepare('SELECT path FROM listing_images WHERE listing_id = ? ORDER BY sort').all(l.id).map((r) => r.path);
  res.json(l);
});
 
app.post('/api/listings', auth, writeLimiter, upload.array('images', 5), (req, res) => {
  const files = req.files || [];
  const fail = (code, msg) => {
    files.forEach((f) => fs.unlink(f.path, () => {}));
    return res.status(code).json({ error: msg });
  };
  const b = req.body;
  const title = str(b.title, 3, 80);
  const description = str(b.description || '', 0, 2000);
  const city = str(b.city, 2, 60);
  const price = Number(b.price);
  const lat = numOrNull(b.lat);
  const lng = numOrNull(b.lng);
  const cond = ['new', 'used', 'refurbished'].includes(b.condition) ? b.condition : 'used';
  const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(Number(b.category_id));
  if (!title || description === null || !city || !cat || !Number.isFinite(price) || price < 0 || price > 1e9) {
    return fail(400, 'Please fill in title, category, price and city correctly');
  }
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat || 0) > 90 || Math.abs(lng || 0) > 180) {
    return fail(400, 'Invalid location');
  }
  if (files.some((f) => !looksLikeImage(f))) return fail(400, 'Only JPG, PNG or WEBP images (max 3 MB each)');
 
  const status = isUnlimited(req.user) ? 'approved' : 'pending';
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO listings (seller_id, category_id, title, description, price, item_condition,
                            city, lat, lng, status, approved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'approved'
              THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') END)`)
      .run(req.user.id, cat.id, title, description, price, cond, city, lat, lng, status, status);
    const ins = db.prepare('INSERT INTO listing_images (listing_id, path, sort) VALUES (?, ?, ?)');
    files.forEach((f, i) => ins.run(info.lastInsertRowid, '/uploads/' + f.filename, i));
    return info.lastInsertRowid;
  });
  try {
    res.json({ id: tx(), status });
  } catch (e) {
    if (/POST_LIMIT/.test(e.message)) {
      return fail(403, `Free sellers can post ${FREE_POST_LIMIT} ads. Ask the admin to approve your account for unlimited posts.`);
    }
    if (/SELLER_BLOCKED/.test(e.message)) return fail(403, 'Your seller account is blocked');
    files.forEach((f) => fs.unlink(f.path, () => {}));
    throw e;
  }
});
 
app.get('/api/my/listings', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT l.id, l.title, l.price, l.status, l.created_at, l.is_sample
      FROM listings l WHERE l.seller_id = ? ORDER BY l.id DESC`).all(req.user.id));
});
 
app.delete('/api/listings/:id', auth, writeLimiter, (req, res) => {
  const l = db.prepare('SELECT seller_id FROM listings WHERE id = ?').get(Number(req.params.id));
  if (!l || (l.seller_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Ad not found' });
  db.prepare("UPDATE listings SET status = 'removed' WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});
 
app.post('/api/listings/:id/report', auth, writeLimiter, (req, res) => {
  const reason = str(req.body.reason, 3, 300);
  if (!reason) return res.status(400).json({ error: 'Please describe the problem' });
  const l = db.prepare("SELECT id FROM listings WHERE id = ? AND status = 'approved'").get(Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'Ad not found' });
  db.prepare('INSERT OR IGNORE INTO reports (listing_id, reporter_id, reason) VALUES (?, ?, ?)').run(l.id, req.user.id, reason);
  res.json({ ok: true });
});
 
// ---------- conversations ----------
app.post('/api/conversations', auth, writeLimiter, (req, res) => {
  const l = db.prepare("SELECT id, seller_id FROM listings WHERE id = ? AND status = 'approved'").get(Number(req.body.listing_id));
  if (!l) return res.status(404).json({ error: 'Ad not found' });
  if (l.seller_id === req.user.id) return res.status(400).json({ error: 'This is your own ad' });
  let c = db.prepare('SELECT id FROM conversations WHERE listing_id = ? AND buyer_id = ?').get(l.id, req.user.id);
  if (!c) {
    const i = db.prepare('INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES (?, ?, ?)').run(l.id, req.user.id, l.seller_id);
    c = { id: i.lastInsertRowid };
  }
  res.json({ id: c.id });
});
 
app.get('/api/conversations', auth, (req, res) => {
  res.json(db.prepare(`
    SELECT c.id, c.listing_id, l.title,
           CASE WHEN c.buyer_id = @me THEN su.name ELSE bu.name END AS other_name,
           (SELECT CASE type WHEN 'location' THEN 'Location shared' ELSE body END
              FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           COALESCE((SELECT created_at FROM messages m WHERE m.conversation_id = c.id
                      ORDER BY m.id DESC LIMIT 1), c.created_at) AS last_at
      FROM conversations c
      JOIN listings l ON l.id = c.listing_id
      JOIN users su ON su.id = c.seller_id
      JOIN users bu ON bu.id = c.buyer_id
     WHERE c.buyer_id = @me OR c.seller_id = @me
     ORDER BY last_at DESC`).all({ me: req.user.id }));
});
 
app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM conversations WHERE id = ?').get(Number(req.params.id));
  if (!c || (c.buyer_id !== req.user.id && c.seller_id !== req.user.id)) return res.status(404).json({ error: 'Chat not found' });
  const rows = db.prepare(`
    SELECT id, conversation_id, sender_id, type, body, lat, lng, created_at
      FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 200`).all(c.id);
  res.json(rows.reverse());
});
 
// ---------- admin ----------
app.get('/api/admin/overview', auth, adminOnly, (req, res) => {
  res.json({
    listings: db.prepare(`
      SELECT l.id, l.title, l.price, l.city, l.created_at, u.id AS seller_id, u.name AS seller_name,
             u.phone, u.seller_status
        FROM listings l JOIN users u ON u.id = l.seller_id
       WHERE l.status = 'pending' ORDER BY l.id`).all(),
    sellers: db.prepare(`
      SELECT id, name, phone, seller_status, created_at FROM users
       WHERE role = 'user' AND seller_status <> 'approved' AND id <> 1
         AND EXISTS (SELECT 1 FROM listings WHERE seller_id = users.id)
       ORDER BY id`).all(),
    reports: db.prepare(`
      SELECT r.id, r.listing_id, l.title, r.reason, r.created_at FROM reports r
        JOIN listings l ON l.id = r.listing_id ORDER BY r.id DESC LIMIT 50`).all(),
  });
});
 
app.patch('/api/admin/listings/:id', auth, adminOnly, (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected', 'removed'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  db.prepare(`UPDATE listings SET status = ?,
              approved_at = CASE WHEN ? = 'approved' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE approved_at END
              WHERE id = ?`).run(status, status, Number(req.params.id));
  res.json({ ok: true });
});
 
app.patch('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const s = req.body.seller_status;
  if (!['pending', 'approved', 'blocked'].includes(s)) return res.status(400).json({ error: 'Bad status' });
  const id = Number(req.params.id);
  db.transaction(() => {
    db.prepare("UPDATE users SET seller_status = ? WHERE id = ? AND role = 'user'").run(s, id);
    if (s === 'approved') { // approving a seller also publishes the ads that were waiting
      db.prepare(`UPDATE listings SET status = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                  WHERE seller_id = ? AND status = 'pending'`).run(id);
    }
  })();
  res.json({ ok: true });
});
 
// ---------- errors ----------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) return res.status(400).json({ error: 'Upload problem: max 5 images, 3 MB each' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});
 
// ---------- realtime chat + live location ----------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGINS }, maxHttpBufferSize: 1e4 });
 
io.use((socket, next) => {
  try {
    const p = jwt.verify(String((socket.handshake.auth || {}).token || ''), JWT_SECRET);
    const u = getUser.get(p.id);
    if (!u) throw new Error('no user');
    socket.user = u;
    next();
  } catch (e) { next(new Error('auth')); }
});
 
const insMsg = db.prepare('INSERT INTO messages (conversation_id, sender_id, type, body, lat, lng) VALUES (?, ?, ?, ?, ?, ?)');
const getMsg = db.prepare('SELECT id, conversation_id, sender_id, type, body, lat, lng, created_at FROM messages WHERE id = ?');
const getConv = db.prepare('SELECT * FROM conversations WHERE id = ?');
 
io.on('connection', (socket) => {
  const uid = socket.user.id;
  socket.join('user:' + uid);
  let sent = []; // timestamps for a simple per-socket rate limit
 
  const myConv = (id) => {
    const c = getConv.get(Number(id));
    return c && (c.buyer_id === uid || c.seller_id === uid) ? c : null;
  };
  const otherOf = (c) => (c.buyer_id === uid ? c.seller_id : c.buyer_id);
  const push = (c, m) => io.to('user:' + c.buyer_id).to('user:' + c.seller_id).emit('chat:message', m);
 
  socket.on('chat:send', (p, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const now = Date.now();
    sent = sent.filter((t) => now - t < 10000);
    if (sent.length >= 20) return reply({ error: 'Slow down' });
    sent.push(now);
    const c = p && myConv(p.conversation_id);
    const body = p && str(p.body, 1, 1000);
    if (!c || !body) return reply({ error: 'Message not sent' });
    const m = getMsg.get(insMsg.run(c.id, uid, 'text', body, null, null).lastInsertRowid);
    push(c, m);
    reply({ ok: true });
  });
 
  let lastLive = 0;
  socket.on('chat:location', (p) => {
    const c = p && myConv(p.conversation_id);
    const lat = Number(p && p.lat);
    const lng = Number(p && p.lng);
    if (!c || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return;
    const now = Date.now();
    if (p.start) {
      push(c, getMsg.get(insMsg.run(c.id, uid, 'location', 'Shared live location', lat, lng).lastInsertRowid));
    } else if (now - lastLive < 2000) {
      return; // ignore floods
    }
    lastLive = now;
    io.to('user:' + otherOf(c)).emit('chat:live', {
      conversation_id: c.id, from: uid, lat, lng,
      accuracy: Math.min(Math.max(Number(p.accuracy) || 0, 0), 100000), at: now,
    });
  });
 
  socket.on('chat:live-stop', (p) => {
    const c = p && myConv(p.conversation_id);
    if (c) io.to('user:' + otherOf(c)).emit('chat:live-stop', { conversation_id: c.id, from: uid });
  });
});
 
server.listen(PORT, () => console.log(`Azmari shop backend running on http://localhost:${PORT}`));
