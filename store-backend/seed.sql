-- Categories (same ones as your current Store tabs). Icons use char(codepoint)
-- so the file stays plain ASCII and works in any terminal.
INSERT OR IGNORE INTO categories (id, slug, name, icon, sort) VALUES
  (1, 'keyboards',   'Keyboards',   char(127929), 1),  -- piano keys
  (2, 'strings',     'Strings',     char(127928), 2),  -- guitar
  (3, 'traditional', 'Traditional', char(129685), 3),  -- banjo
  (4, 'percussion',  'Percussion',  char(129345), 4),  -- drum
  (5, 'wind',        'Wind',        char(127930), 5),  -- trumpet
  (6, 'audio',       'Audio',       char(127911), 6),  -- headphones
  (7, 'rental',      'Rental',      char(128266), 7);  -- speaker
 
-- SAMPLE SELLERS (approved, cannot log in: password hash '!' never matches).
-- TWO SAMPLE ADS (is_sample = 1) from your Store screenshot. Re-running setup.sh resets them.
-- Remove them later with:  DELETE FROM listings WHERE is_sample = 1;
DELETE FROM listings WHERE is_sample = 1;
INSERT INTO users (name, phone, password_hash, role, seller_status)
VALUES ('Amine Yusuf', '+251900000011', '!', 'user', 'approved')
ON CONFLICT(phone) DO UPDATE SET name = excluded.name, seller_status = 'approved';
INSERT INTO listings (seller_id, category_id, title, description, price, item_condition, city, lat, lng, status, is_sample, created_at, approved_at)
VALUES ((SELECT id FROM users WHERE phone = '+251900000011'), 2, 'Violin', '4/4 violin with bow, rosin and case.', 9500, 'used', 'Hawassa', 7.0621, 38.4763, 'approved', 1,
        strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours'));
INSERT INTO users (name, phone, password_hash, role, seller_status)
VALUES ('Chala Gemechu', '+251900000012', '!', 'user', 'approved')
ON CONFLICT(phone) DO UPDATE SET name = excluded.name, seller_status = 'approved';
INSERT INTO listings (seller_id, category_id, title, description, price, item_condition, city, lat, lng, status, is_sample, created_at, approved_at)
VALUES ((SELECT id FROM users WHERE phone = '+251900000012'), 2, 'Bass guitar', '4-string bass guitar, great tone, strap included.', 13200, 'used', 'Adama', 8.54, 39.27, 'approved', 1,
        strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day'), strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day'));
