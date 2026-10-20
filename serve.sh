#!/usr/bin/env bash
# macOS / Linux launcher: serve this folder over http://localhost:8000
# and open the viewer. Windows users: use serve.bat instead.
set -u
cd "$(dirname "$0")" || exit 1

PORT="${1:-8000}"
PY=""

for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo ""
  echo "  [ERROR] python3 / python not found in PATH."
  echo "  Install Python 3, or serve this folder with any static server, e.g."
  echo "      npx --yes serve -l $PORT ."
  echo ""
  exit 1
fi

URL="http://localhost:$PORT/subway-map.html"
echo ""
echo "  subway-map :: local static data viewer"
echo "  url  : $URL"
echo "  stop : Ctrl+C"
echo ""

# 打开浏览器（后台，失败不影响服务）
( sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  fi
) >/dev/null 2>&1 &

exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
