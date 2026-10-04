#!/usr/bin/env bash
# Applies db/migrations/*.sql in filename order, once each, each in its own transaction.
# Usage: DATABASE_URL=postgres://user:pass@host:5432/dbname ./db/migrate.sh
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL (see .env.example)}"

DIR="$(cd "$(dirname "$0")" && pwd)/migrations"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"

for f in "$DIR"/*.sql; do
  name="$(basename "$f")"
  done_already="$(psql "$DATABASE_URL" -tA -c "SELECT 1 FROM schema_migrations WHERE filename = '$name'")"
  if [ -z "$done_already" ]; then
    echo "applying $name"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
         -f "$f" -c "INSERT INTO schema_migrations (filename) VALUES ('$name')"
  else
    echo "skipping $name (already applied)"
  fi
done
echo "migrations up to date"
