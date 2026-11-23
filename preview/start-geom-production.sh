#!/bin/sh
# Production geom OMR API. Bind 127.0.0.1 only. Do not serve the public
# static tree from this process; nginx proxies /api/geom-omr here.
# Prefer the systemd unit (puxian-geom-omr.service) over nohup.
set -eu
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
if [ ! -d "$ROOT/preview" ]; then
  ROOT="$(CDPATH= cd -- "$(dirname "$0")" && pwd)/.."
  ROOT="$(CDPATH= cd -- "$ROOT" && pwd)"
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
export GEOM_PRODUCTION=1
export GEOM_API_ONLY=1
export GEOM_KEEP_LAST_JOB=0
export GEOM_HOST="${GEOM_HOST:-127.0.0.1}"
export GEOM_PORT="${GEOM_PORT:-18096}"
export GEOM_DEVICE="${GEOM_DEVICE:-cpu}"
export GEOM_VENDOR="${GEOM_VENDOR:-$ROOT/vendor}"
export COPISTERIA_ROOT="${COPISTERIA_ROOT:-$ROOT/vendor/copisteria}"
export GEOM_SCRIPT_DIR="${GEOM_SCRIPT_DIR:-$ROOT/vendor}"
export GEOM_WEIGHTS="${GEOM_WEIGHTS:-$ROOT/vendor/copisteria/models/small/v7_obj-recall-30m_best.pt}"
export GEOM_MAX_UPLOAD="${GEOM_MAX_UPLOAD:-20971520}"
export GEOM_MAX_CONCURRENT="${GEOM_MAX_CONCURRENT:-1}"
export GEOM_RATE_MAX="${GEOM_RATE_MAX:-6}"
export GEOM_RATE_WINDOW="${GEOM_RATE_WINDOW:-600}"
if [ "$GEOM_HOST" != "127.0.0.1" ] && [ "$GEOM_HOST" != "::1" ]; then
  echo "production must bind 127.0.0.1 only" >&2
  exit 1
fi
if [ ! -f "$GEOM_WEIGHTS" ]; then
  echo "missing detector weights at $GEOM_WEIGHTS" >&2
  exit 1
fi
# Logs are process stderr only; do not write uploaded scores to disk.
exec "$PYTHON" "$ROOT/preview/geom_omr_server.py"
