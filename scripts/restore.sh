#!/usr/bin/env sh
# Restaura um backup feito por scripts/backup.sh na instalação atual.
#   scripts/restore.sh backups/status-page-<data>
# ATENÇÃO: substitui o banco e os arquivos atuais. Use o mesmo APP_SECRET (.env)
# da instalação de origem e a mesma versão (ou mais nova) das imagens.
set -eu

SRC="${1:?informe a pasta do backup}"
test -f "$SRC/database.dump" || { echo "database.dump não encontrado em $SRC"; exit 1; }
( cd "$SRC" && sha256sum -c SHA256SUMS )

printf 'Isto substitui os dados atuais. Digite "restaurar" para continuar: '
read -r answer
[ "$answer" = "restaurar" ] || { echo "cancelado"; exit 1; }

echo "→ parando a aplicação"
docker compose stop proxy web api worker monitor

echo "→ banco de dados"
docker compose up -d --wait postgres
docker compose exec -T postgres dropdb -U status --if-exists --force status
docker compose exec -T postgres createdb -U status status
docker compose exec -T postgres pg_restore -U status -d status --no-owner --exit-on-error < "$SRC/database.dump"

echo "→ arquivos enviados e certificados"
docker compose run --rm --no-deps -T --entrypoint sh api -c 'rm -rf /data/uploads/* && tar xzf - -C /data/uploads' < "$SRC/uploads.tar.gz"
docker compose run --rm --no-deps -T --entrypoint sh proxy -c 'rm -rf /data/* && tar xzf - -C /data' < "$SRC/caddy-data.tar.gz"

echo "→ subindo (as migrações de versões mais novas rodam sozinhas)"
docker compose up -d --wait
echo "Restauração concluída."
