#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a; source "$PROJECT_DIR/.env"; set +a
fi

PORT="${PORT:-3001}"

echo "🐾 Starting OpenClaw Pi Assistant on :${PORT}"

# Start server in background
cd "$PROJECT_DIR"
node server/index.js &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

sleep 2

# Launch Chromium kiosk (if DISPLAY is set)
if [ -n "${DISPLAY:-}" ]; then
  echo "Launching Chromium kiosk..."
  chromium-browser \
    --kiosk \
    --noerrdialogs \
    --disable-translate \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-component-update \
    --check-for-update-interval=31536000 \
    "http://localhost:${PORT}" &
  CHROME_PID=$!
  echo "Chromium PID: $CHROME_PID"
fi

# Wait for server
wait $SERVER_PID
