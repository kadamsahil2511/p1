#!/bin/sh
set -eu
umask 077
/opt/venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8765 &
api_pid=$!
cleanup() { kill "$api_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
node --import tsx src/server.ts
