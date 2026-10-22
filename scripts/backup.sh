#!/usr/bin/env sh
# Backup completo: banco (pg_dump), arquivos enviados (logos, fontes) e certificados
# do Caddy. Rode na pasta da instalação (onde está o compose.yaml):
#   scripts/backup.sh [pasta-de-destino]
# Guarde também o arquivo .env em lugar seguro: sem o APP_SECRET os segredos
# cifrados (SMTP, LDAP, webhooks) não podem ser lidos.
set -eu

DEST="${1:-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DEST/status-page-$STAMP"
mkdir -p "$OUT"

echo "→ banco de dados"
docker compose exec -T postgres pg_dump -U status -d status --format=custom --no-owner > "$OUT/database.dump"

echo "→ arquivos enviados"
docker compose exec -T api tar czf - -C /data/uploads . > "$OUT/uploads.tar.gz"

echo "→ certificados (Caddy)"
docker compose exec -T proxy tar czf - -C /data . > "$OUT/caddy-data.tar.gz"

docker compose exec -T api node -p "require('./package.json').version" > "$OUT/VERSION"
( cd "$OUT" && sha256sum database.dump uploads.tar.gz caddy-data.tar.gz VERSION > SHA256SUMS )

echo "Backup em $OUT ($(du -sh "$OUT" | cut -f1))."
echo "Lembre-se: o .env (APP_SECRET) não está no backup; guarde-o separadamente."
