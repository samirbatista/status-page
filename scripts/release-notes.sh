#!/usr/bin/env sh
# Gera as notas da release de uma tag: seção do CHANGELOG, caminho de atualização
# (docs/ATUALIZACAO.md) e imagens. Links relativos viram links para os arquivos da tag,
# porque a página da release não resolve caminhos relativos.
#   scripts/release-notes.sh v1.0.3 [owner/repo] > notes.md
set -eu

TAG="$1"
REPO="${2:-${GITHUB_REPOSITORY:-samirbatista/status-page}}"
VERSION="${TAG#v}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BLOB="https://github.com/$REPO/blob/$TAG"
IMAGES="ghcr.io/$(echo "$REPO" | tr '[:upper:]' '[:lower:]')"

# Links relativos ](caminho) → ](BLOB/base/caminho); mantém http(s), mailto e âncoras (#).
absolute() {
  sed -E "s#\]\(([^):#][^):]*)\)#](__BASE__/\1)#g; s#__BASE__#$1#g"
}

changelog="$(awk -v v="$VERSION" '
  BEGIN { gsub(/\./, "\\.", v) }
  $0 ~ "^## \\[?" v "\\]?([^0-9.]|$)" { show = 1; next }
  show && /^## / { exit }
  show { print }
' "$DIR/CHANGELOG.md")"
[ -n "$changelog" ] || { echo "CHANGELOG.md: falta a seção da versão $VERSION" >&2; exit 1; }

NOTES="$(
  printf '%s\n' "$changelog" | absolute "$BLOB"
  echo
  echo "## Caminho de atualização"
  echo
  sh "$DIR/scripts/upgrade-path.sh" show "$VERSION" | sed '/./,$!d' | absolute "$BLOB/docs"
  echo
  echo "Antes de atualizar, leia [docs/ATUALIZACAO.md]($BLOB/docs/ATUALIZACAO.md)."
  echo
  echo "## Imagens"
  echo
  echo '```'
  echo "$IMAGES/{api,worker,monitor,web,migrate}:$VERSION"
  echo '```'
  echo
  echo "Instalação: [docs/INSTALACAO.md]($BLOB/docs/INSTALACAO.md)."
)"

# Arquivo que ainda não existia na tag (release antiga) → link para o main.
if git -C "$DIR" rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
  for path in $(printf '%s\n' "$NOTES" | grep -oE "$BLOB/[^)#]+" | sed "s#^$BLOB/##" | sort -u); do
    git -C "$DIR" cat-file -e "$TAG:$path" 2> /dev/null ||
      NOTES="$(printf '%s\n' "$NOTES" | sed "s#$BLOB/$path#https://github.com/$REPO/blob/main/$path#g")"
  done
fi

# Nenhum link relativo pode sobrar.
if printf '%s\n' "$NOTES" | grep -nE '\]\([^):#][^):]*\)' >&2; then
  echo "notas com link relativo (acima)" >&2
  exit 1
fi
printf '%s\n' "$NOTES"
