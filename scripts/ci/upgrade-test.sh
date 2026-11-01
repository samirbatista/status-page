#!/usr/bin/env bash
# Teste de atualização (CI): instala a última release publicada, cria dados, atualiza para
# as imagens construídas a partir deste código e confere que nada se perdeu.
#   FROM=v1.0.2 scripts/ci/upgrade-test.sh
# Variáveis: FROM (padrão: a maior tag vX.Y.Z), FROM_PREFIX (registro das imagens da
# release; padrão ghcr.io/samirbatista/status-page), SKIP_PULL=1 (imagens já locais),
# SKIP_BUILD=1 (imagens status-page/*:latest já construídas).
# Escreve o .env da pasta e termina com down -v: use só no CI ou numa cópia do repositório.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
FROM="${FROM:-$(git tag -l 'v*.*.*' | sort -V | tail -1)}"
FROM_PREFIX="${FROM_PREFIX:-ghcr.io/samirbatista/status-page}"
TO="$(jq -r .version package.json)"
PREV="$(mktemp -d)/prev"
BASE=http://localhost
PASSWORD="$(openssl rand -hex 16)"
[ -n "$FROM" ] || { echo "nenhuma release anterior (tag vX.Y.Z) encontrada"; exit 1; }
echo "::group::Atualização ${FROM#v} → $TO"

cleanup() {
  docker compose --project-directory "$ROOT" down -v --remove-orphans > /dev/null 2>&1 || true
  git worktree remove --force "$PREV" > /dev/null 2>&1 || true
}
trap cleanup EXIT

common_env() {
  cat <<EOF
POSTGRES_PASSWORD=$(cat "$ROOT/.upgrade-pg")
APP_SECRET=$(cat "$ROOT/.upgrade-secret")
SEED_OWNER_EMAIL=admin@example.com
SEED_OWNER_PASSWORD=$PASSWORD
SEED_DEMO_PAGE=true
EOF
}
openssl rand -hex 24 > .upgrade-pg
openssl rand -base64 32 > .upgrade-secret
trap 'cleanup; rm -f "$ROOT/.upgrade-pg" "$ROOT/.upgrade-secret"' EXIT

# Não roda sobre uma instalação existente (o teste termina com down -v).
if docker volume inspect status-page_postgres-data > /dev/null 2>&1; then
  echo "já existe uma instalação (volume status-page_postgres-data); rode em uma máquina limpa"
  trap - EXIT
  rm -f "$ROOT/.upgrade-pg" "$ROOT/.upgrade-secret"
  exit 1
fi

echo "→ instala a ${FROM#v} a partir das imagens publicadas"
git worktree add --quiet --detach "$PREV" "$FROM"
{ common_env; echo "IMAGE_PREFIX=$FROM_PREFIX"; echo "IMAGE_TAG=${FROM#v}"; } > "$PREV/.env"
cp "$PREV/.env" .env # permite o down -v da limpeza desde já
(
  cd "$PREV"
  [ -n "${SKIP_PULL:-}" ] || docker compose pull --quiet
  docker compose up -d --no-build --wait --wait-timeout 180
)

api() { curl -fsS -b cookies.txt -H 'X-Requested-With: status-page' -H 'Content-Type: application/json' "$@"; }
login() {
  curl -fsS -c cookies.txt -H 'X-Requested-With: status-page' -H 'Content-Type: application/json' \
    -d "{\"email\":\"admin@example.com\",\"password\":\"$PASSWORD\"}" $BASE/api/auth/login > /dev/null
}

echo "→ cria dados na ${FROM#v}"
login
PAGE=$(api -d '{"slug":"upgrade","name":"Upgrade Status"}' $BASE/api/pages | jq -r .id)
COMP=$(api -d '{"name":"Portal"}' $BASE/api/pages/$PAGE/components | jq -r .id)
api -d "{\"title\":\"Incidente antes da atualização\",\"impact\":\"minor\",\"status\":\"investigating\",\"body\":\"Investigando.\",\"notify\":false,\"components\":[{\"componentId\":\"$COMP\",\"status\":\"degraded_performance\"}]}" \
  $BASE/api/pages/$PAGE/incidents > /dev/null
TOKEN=$(api -d '{"name":"upgrade","role":"viewer"}' $BASE/api/pages/$PAGE/api-tokens | jq -r .token)
cp cookies.txt cookies-before.txt

echo "→ atualiza para a $TO (imagens deste código)"
{ common_env; echo "IMAGE_PREFIX=status-page"; echo "IMAGE_TAG=latest"; } > .env
[ -n "${SKIP_BUILD:-}" ] || docker compose build --quiet
docker compose up -d --no-build --wait --wait-timeout 180
test "$(docker inspect -f '{{.State.ExitCode}}' "$(docker compose ps -aq migrate)")" = 0

echo "→ confere os dados depois da atualização"
set -x
curl -fsS $BASE/api/readyz | grep '"status":"ok"' > /dev/null
curl -fsS $BASE/api/docs/openapi.json | jq -e --arg v "$TO" '.info.version == $v'
# Sessão aberta antes da atualização continua válida.
curl -fsS -b cookies-before.txt $BASE/api/auth/me | jq -e '.isOwner == true'
# Página, componente e incidente preservados.
curl -fsS $BASE/api/public/pages/upgrade | jq -e '.page.name == "Upgrade Status" and (.activeIncidents | length) == 1'
curl -fsS $BASE/api/public/pages/upgrade/status.json | jq -e '.status != "operational"'
curl -fsS $BASE/api/public/pages/upgrade/feed.atom | grep 'Incidente antes da atualização' > /dev/null
# Token criado na versão anterior continua funcionando.
curl -fsS -H "Authorization: Bearer $TOKEN" $BASE/api/pages/$PAGE/incidents |
  grep 'Incidente antes da atualização' > /dev/null
# Página de demonstração e página pública renderizada.
curl -fsS $BASE/api/public/pages/demo/status.json | jq -e '.status == "operational"'
curl -fsS $BASE/p/upgrade | grep 'Upgrade Status' > /dev/null
set +x
rm -f cookies.txt cookies-before.txt
echo "::endgroup::"
echo "Atualização ${FROM#v} → $TO sem perda de dados."
