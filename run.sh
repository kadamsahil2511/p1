#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -f .env ]]; then echo 'Copy .env.example to .env and fill in the secrets.' >&2; exit 1; fi
set -a
source .env
set +a
mkdir -p "${DATA_DIR:-./data}"
"${PYTHON_BIN:-.venv/bin/python}" -m uvicorn api:app --host 127.0.0.1 --port 8766 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
node --import tsx src/server.ts
