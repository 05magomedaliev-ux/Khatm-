#!/usr/bin/env bash
# Резервная копия базы. Нужен pg_dump той же основной версии, что и сервер.
#   DATABASE_DIRECT_URL=postgresql://... bash scripts/backup.sh [каталог] [дней хранения]
# Для Supabase используйте прямое подключение или Session pooler (порт 5432),
# а не Transaction pooler.
set -euo pipefail

URL="${DATABASE_DIRECT_URL:-${DATABASE_URL:-}}"
DIR="${1:-backups}"
KEEP_DAYS="${2:-30}"

if [[ -z "$URL" ]]; then
  echo "Укажите DATABASE_DIRECT_URL" >&2
  exit 1
fi

mkdir -p "$DIR"
FILE="$DIR/khatm-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=app --file="$FILE" "$URL"
pg_restore --list "$FILE" > /dev/null
find "$DIR" -name 'khatm-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "Готово: $FILE"
