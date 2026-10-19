#!/usr/bin/env bash
# Starts both processes of the single-container image (see Dockerfile).
# If either one exits, the container exits too, so Coolify restarts it.
set -uo pipefail

uvicorn app.main:app --host 127.0.0.1 --port 8001 &
API_PID=$!

(cd /dashboard && PORT="${PORT:-8000}" exec node server.js) &
WEB_PID=$!

trap 'kill "$API_PID" "$WEB_PID" 2>/dev/null' TERM INT

wait -n "$API_PID" "$WEB_PID"
STATUS=$?
echo "a process exited (status $STATUS); stopping the container" >&2
kill "$API_PID" "$WEB_PID" 2>/dev/null
wait
exit "$STATUS"
