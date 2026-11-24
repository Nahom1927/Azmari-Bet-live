const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_FILE || path.join(__dirname, 'shop.db'));
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
const n = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (n === 0) { db.exec(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8')); console.log('Seeded database'); }
else console.log('Database already set up');
db.close();
