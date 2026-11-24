PRAGMA foreign_keys = ON;
 
-- USERS: every buyer/seller. seller_status is controlled by the admin.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('user','admin')),
  seller_status TEXT NOT NULL DEFAULT 'pending'
                CHECK (seller_status IN ('pending','approved','blocked')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
 
CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
 
-- LISTINGS: the ads. status: pending -> approved | rejected, later removed/sold.
CREATE TABLE IF NOT EXISTS listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  price         REAL NOT NULL CHECK (price >= 0),
  currency      TEXT NOT NULL DEFAULT 'ETB',
  item_condition TEXT NOT NULL DEFAULT 'used'
                CHECK (item_condition IN ('new','used','refurbished')),
  city          TEXT NOT NULL,
  lat           REAL CHECK (lat BETWEEN -90 AND 90),
  lng           REAL CHECK (lng BETWEEN -180 AND 180),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','removed','sold')),
  is_sample     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  approved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_feed
  ON listings (status, category_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings (seller_id);
 
CREATE TABLE IF NOT EXISTS listing_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_images_listing ON listing_images (listing_id);
 
-- CHAT: one conversation per (listing, buyer). The seller is the listing owner.
CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (listing_id, buyer_id),
  CHECK (buyer_id <> seller_id)
);
 
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text','location')),
  body            TEXT NOT NULL DEFAULT '',
  lat             REAL,
  lng             REAL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, id);
 
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (listing_id, reporter_id)
);
 
-- RULE 1: a seller the admin has NOT approved can only ever hold 2 ads.
-- (rejected ads do not count). Admins and approved sellers are unlimited.
CREATE TRIGGER IF NOT EXISTS trg_post_limit
BEFORE INSERT ON listings
WHEN (SELECT seller_status FROM users WHERE id = NEW.seller_id) <> 'approved'
 AND (SELECT role FROM users WHERE id = NEW.seller_id) <> 'admin'
 AND (SELECT COUNT(*) FROM listings
       WHERE seller_id = NEW.seller_id AND status <> 'rejected') >= 10
BEGIN
  SELECT RAISE(ABORT, 'POST_LIMIT');
END;
 
-- RULE 2: blocked sellers cannot post at all.
CREATE TRIGGER IF NOT EXISTS trg_blocked_seller
BEFORE INSERT ON listings
WHEN (SELECT seller_status FROM users WHERE id = NEW.seller_id) = 'blocked'
BEGIN
  SELECT RAISE(ABORT, 'SELLER_BLOCKED');
END;
