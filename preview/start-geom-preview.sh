#!/bin/sh
# Local geom-OMR preview. Bind 127.0.0.1 only. Do not use ports occupied
# by Hiddify (17078/12334/12336/12337/16756) or system 5000/7000.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
# When this script is copied to ~/puxian-geom-preview, ROOT is that directory.
if [ -d "$ROOT/preview" ]; then
  :
else
  ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
fi
cd "$ROOT"
if [ -x "$ROOT/venv/bin/python" ]; then
  PYTHON="$ROOT/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="$(command -v python3)"
else
  echo "python3 not found" >&2
  exit 1
fi
export GEOM_STATIC="${GEOM_STATIC:-$ROOT/dist-static}"
export GEOM_VENDOR="${GEOM_VENDOR:-$ROOT/vendor}"
export COPISTERIA_ROOT="${COPISTERIA_ROOT:-$ROOT/vendor/copisteria}"
export GEOM_SCRIPT_DIR="${GEOM_SCRIPT_DIR:-$ROOT/vendor}"
export GEOM_WEIGHTS="${GEOM_WEIGHTS:-$ROOT/vendor/copisteria/models/small/v7_obj-recall-30m_best.pt}"
export GEOM_HOST="${GEOM_HOST:-127.0.0.1}"
export GEOM_PORT="${GEOM_PORT:-18095}"
if [ ! -d "$GEOM_STATIC" ]; then
  echo "missing dist-static at $GEOM_STATIC; copy the built preview or run npm run build:static" >&2
  exit 1
fi
if [ ! -f "$GEOM_WEIGHTS" ]; then
  echo "missing detector weights at $GEOM_WEIGHTS" >&2
  exit 1
fi
mkdir -p "$ROOT/logs"
LOG="$ROOT/logs/geom-preview.log"
# exec so the recorded PID is the server itself when launched with nohup
exec "$PYTHON" "$ROOT/preview/geom_omr_server.py" >>"$LOG" 2>&1
