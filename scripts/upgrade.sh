#!/usr/bin/env sh
# Atualiza a instalação para outra versão seguindo o caminho documentado em
# docs/ATUALIZACAO.md. Rode na pasta da instalação (onde está o compose.yaml):
#   scripts/upgrade.sh [-y] <versão> [pasta-de-backups]
# -y não pede confirmação. Recusa downgrades e saltos que o caminho não permite.
set -eu

# O git checkout troca este arquivo enquanto ele roda: executa a partir de uma cópia.
if [ -z "${SP_UPGRADE_COPY:-}" ]; then
  COPY="$(mktemp)"
  cp "$0" "$COPY"
  SP_UPGRADE_COPY="$COPY" exec sh "$COPY" "$@"
fi
trap 'rm -f "$SP_UPGRADE_COPY" "${DOC:-}" "${PATHS:-}"' EXIT

YES=""
if [ "${1:-}" = "-y" ]; then YES=1; shift; fi
[ $# -ge 1 ] || { echo "uso: scripts/upgrade.sh [-y] <versão> [pasta-de-backups]" >&2; exit 2; }
TARGET="${1#v}"
DEST="${2:-backups}"

die() { echo "✗ $*" >&2; exit 1; }
older() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" = "$1" ]; }

[ -f compose.yaml ] && [ -f .env ] || die "rode na pasta da instalação (compose.yaml e .env)."
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  die "há alterações locais em arquivos versionados (git status). Guarde-as antes (veja docs/ATUALIZACAO.md)."

CURRENT="$(docker compose exec -T api node -p "require('./package.json').version" 2>/dev/null || true)"
[ -n "$CURRENT" ] || CURRENT="$(sed -n 's/^IMAGE_TAG=//p' .env)"
echo "→ versão instalada: $CURRENT"
[ "$CURRENT" != "$TARGET" ] || { echo "Já está na versão $TARGET."; exit 0; }
older "$TARGET" "$CURRENT" && die "a $TARGET é mais antiga que a $CURRENT. Para voltar, veja \"Voltando atrás\" em docs/ATUALIZACAO.md."

echo "→ buscando a tag v$TARGET"
git fetch --quiet --depth 1 origin "refs/tags/v$TARGET:refs/tags/v$TARGET" 2>/dev/null ||
  git fetch --quiet --tags origin || true
git rev-parse --quiet --verify "refs/tags/v$TARGET" > /dev/null || die "a versão v$TARGET não existe."

DOC="$(mktemp)"
PATHS="$(mktemp)"
git show "v$TARGET:docs/ATUALIZACAO.md" > "$DOC" 2>/dev/null &&
  git show "v$TARGET:scripts/upgrade-path.sh" > "$PATHS" 2>/dev/null ||
  die "a v$TARGET não tem caminho de atualização documentado. Siga a atualização manual de docs/INSTALACAO.md."
MIN="$(sh "$PATHS" from "$TARGET" "$DOC")" || die "não foi possível ler o caminho de atualização da $TARGET."
older "$CURRENT" "$MIN" &&
  die "a $TARGET só atualiza a partir da $MIN. Atualize primeiro para a $MIN (scripts/upgrade.sh $MIN) e depois para a $TARGET."

echo
echo "Caminho de atualização da $TARGET:"
sh "$PATHS" show "$TARGET" "$DOC"
echo
if [ -z "$YES" ]; then
  printf 'Atualizar de %s para %s? Digite "sim": ' "$CURRENT" "$TARGET"
  read -r answer
  [ "$answer" = "sim" ] || die "cancelado."
fi

echo "→ backup"
scripts/backup.sh "$DEST"

echo "→ arquivos da v$TARGET"
git checkout --quiet "v$TARGET"
sed -i.bak "s/^IMAGE_TAG=.*/IMAGE_TAG=$TARGET/" .env && rm -f .env.bak
grep -q '^IMAGE_TAG=' .env || echo "IMAGE_TAG=$TARGET" >> .env

echo "→ imagens"
docker compose pull
docker compose up -d --no-build --wait

NOW="$(docker compose exec -T api node -p "require('./package.json').version")"
[ "$NOW" = "$TARGET" ] || die "a API respondeu na versão $NOW, esperada $TARGET. Veja docker compose logs."
echo "✓ Atualizado para a $TARGET. Confira a página e o painel; para voltar, veja docs/ATUALIZACAO.md."
