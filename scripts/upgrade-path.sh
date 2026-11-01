#!/usr/bin/env sh
# Lê o caminho de atualização de uma versão em docs/ATUALIZACAO.md.
#   scripts/upgrade-path.sh check [versão] [arquivo]   confere se a seção existe e está completa
#   scripts/upgrade-path.sh show  [versão] [arquivo]   imprime a seção
#   scripts/upgrade-path.sh from  [versão] [arquivo]   versão mínima de origem
# Sem versão, usa a do package.json; sem arquivo, docs/ATUALIZACAO.md.
set -eu

CMD="${1:-check}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${2:-}"
FILE="${3:-$DIR/docs/ATUALIZACAO.md}"
if [ -z "$VERSION" ]; then
  VERSION="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$DIR/package.json" | head -1)"
fi
VERSION="${VERSION#v}"

section() {
  awk -v v="$VERSION" '
    BEGIN { gsub(/\./, "\\.", v) }
    $0 ~ "^### v?" v "([^0-9.]|$)" { show = 1; next }
    show && /^##/ { exit }
    show { print }
  ' "$FILE"
}

SECTION="$(section)"
if [ -z "$SECTION" ]; then
  echo "docs/ATUALIZACAO.md: falta a seção \"### $VERSION\" em Caminhos de atualização." >&2
  exit 1
fi

case "$CMD" in
  show)
    printf '%s\n' "$SECTION"
    ;;
  from)
    printf '%s\n' "$SECTION" | sed -n 's/^- \*\*Atualiza a partir de:\*\* *//p' | head -1 |
      grep -o '^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' || {
        echo "Versão $VERSION: \"Atualiza a partir de\" não indica uma versão (instalação inicial?)." >&2
        exit 1
      }
    ;;
  check)
    missing=""
    for field in 'Atualiza a partir de' 'Banco de dados' 'Configuração' 'Ação manual' \
      'Indisponibilidade' 'Volta sem restaurar backup'; do
      printf '%s\n' "$SECTION" | grep -q "^- \*\*$field:\*\* *[^ ]" || missing="$missing\n  - $field"
    done
    if [ -n "$missing" ]; then
      printf 'docs/ATUALIZACAO.md, seção %s: campos ausentes ou vazios:%b\n' "$VERSION" "$missing" >&2
      exit 1
    fi
    grep -q "^| $VERSION " "$FILE" || {
      echo "docs/ATUALIZACAO.md: falta a linha da versão $VERSION na tabela de Resumo." >&2
      exit 1
    }
    echo "Caminho de atualização da versão $VERSION documentado."
    ;;
  *)
    echo "uso: $0 check|show|from [versão] [arquivo]" >&2
    exit 2
    ;;
esac
