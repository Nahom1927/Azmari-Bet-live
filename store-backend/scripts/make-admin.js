'use strict';
// Usage: ADMIN_PW='your-password' node scripts/make-admin.js +2519XXXXXXXX "Admin Name"
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
 
const phone = (process.argv[2] || '').replace(/[\s-]/g, '');
const name = process.argv[3] || 'Admin';
const pw = process.env.ADMIN_PW || '';
if (!/^\+?[0-9]{9,15}$/.test(phone) || pw.length < 8) {
  console.error('Usage: ADMIN_PW=<8+ chars> node scripts/make-admin.js +2519XXXXXXXX "Name"');
  process.exit(1);
}
const db = new Database(process.env.DB_FILE || path.join(__dirname, '..', 'shop.db'));
const hash = bcrypt.hashSync(pw, 10);
const row = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
if (row) {
  db.prepare("UPDATE users SET role = 'admin', seller_status = 'approved', password_hash = ?, name = ? WHERE id = ?")
    .run(hash, name, row.id);
  console.log('Existing user promoted to admin:', phone);
} else {
  db.prepare("INSERT INTO users (name, phone, password_hash, role, seller_status) VALUES (?, ?, ?, 'admin', 'approved')")
    .run(name, phone, hash);
  console.log('Admin created:', phone);
}
