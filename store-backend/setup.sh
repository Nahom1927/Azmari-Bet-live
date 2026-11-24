#!/bin/sh
# One-time setup: creates .env (random secret) and the SQLite database.
cd "$(dirname "$0")" || exit 1
[ -f .env ] || { printf 'JWT_SECRET=%s\nPORT=8080\nCORS_ORIGINS=http://localhost:8080,http://localhost:8080,https://nahom1927.github.io\n' "$(openssl rand -hex 32)" > .env; chmod 600 .env; echo ".env created"; }
sqlite3 shop.db < schema.sql && sqlite3 shop.db < seed.sql && echo "database ready"
