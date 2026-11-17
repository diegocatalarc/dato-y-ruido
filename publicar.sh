#!/usr/bin/env bash
# Publica el sitio del podcast en GitHub Pages.
#
# Requisitos: gh autenticado (`gh auth login -h github.com`) y Node 24.
# Uso: ./publicar.sh [nombre-del-repositorio]
#
# Es idempotente: si el repositorio ya existe, vuelve a subir los cambios y
# re-publica; si GitHub Pages ya está activo, no falla.

set -euo pipefail
cd "$(dirname "$0")"

REPO="${1:-dato-y-ruido}"

if ! command -v gh >/dev/null 2>&1; then
  echo "Falta el CLI de GitHub. Instálalo con: brew install gh"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh no está autenticado. Ejecuta primero:"
  echo "  gh auth login -h github.com"
  exit 1
fi

# Credenciales de git para el push (idempotente).
gh auth setup-git >/dev/null 2>&1 || true

LOGIN="$(gh api user --jq .login)"
URL="https://${LOGIN}.github.io/${REPO}"

echo "Cuenta:      ${LOGIN}"
echo "Repositorio: ${LOGIN}/${REPO}"
echo "Sitio:       ${URL}/"
echo

# La URL base del feed y del sitio debe ser la definitiva antes de construir.
python3 - "$URL" <<'PY'
import json
import sys
from pathlib import Path

ruta = Path("podcast.json")
datos = json.loads(ruta.read_text(encoding="utf-8"))
datos["urlBase"] = sys.argv[1]
ruta.write_text(json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY

echo "Construyendo el sitio…"
node construir.mjs

if [ ! -d .git ]; then
  git init -b main >/dev/null
fi
git config user.name "${LOGIN}"
git config user.email "${LOGIN}@users.noreply.github.com"
git add -A

if ! git diff --cached --quiet; then
  git commit -m "Dato y Ruido · publicación del sitio" >/dev/null
  echo "Commit creado."
else
  echo "Sin cambios que commitear."
fi

if gh repo view "${LOGIN}/${REPO}" >/dev/null 2>&1; then
  echo "El repositorio ya existe."
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${LOGIN}/${REPO}.git"
else
  echo "Creando el repositorio público…"
  gh repo create "${LOGIN}/${REPO}" --public --source=. --remote=origin >/dev/null
fi

# Pages con origen «GitHub Actions». POST si no está configurado; PATCH si ya existe.
gh api -X POST "repos/${LOGIN}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || gh api -X PATCH "repos/${LOGIN}/${REPO}/pages" -f build_type=workflow >/dev/null 2>&1 \
  || true

echo "Subiendo…"
git push -u origin main

echo
echo "Esperando a que GitHub Pages publique (puede tardar un minuto)…"
for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "${URL}/"; then
    echo "Publicado: ${URL}/"
    echo "Feed:      ${URL}/feed.xml"
    exit 0
  fi
  sleep 6
done

echo "El push se completó, pero el sitio aún no responde."
echo "Revisa la pestaña Actions: https://github.com/${LOGIN}/${REPO}/actions"
exit 1
