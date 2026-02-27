#!/bin/bash
set -e

# OpenClaw Pi Assistant - Start Script
# Launches the server and optionally Chromium in kiosk mode

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOME_DIR="${HOME:-/home/pi}"

PORT="${PORT:-3001}"
KIOSK="${KIOSK:-true}"
DISPLAY="${DISPLAY:-:0}"

export WHISPER_PATH="${WHISPER_PATH:-/usr/local/bin/whisper}"
export WHISPER_MODEL="${WHISPER_MODEL:-$HOME_DIR/.whisper/ggml-base.en.bin}"
export PIPER_PATH="${PIPER_PATH:-/usr/local/bin/piper}"
export PIPER_MODEL="${PIPER_MODEL:-$HOME_DIR/.piper/en_US-lessac-medium.onnx}"
export OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-openclaw}"
export NODE_ENV="${NODE_ENV:-production}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

cleanup() {
    info "Shutting down..."
    
    if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    
    if [[ -n "$CHROMIUM_PID" ]] && kill -0 "$CHROMIUM_PID" 2>/dev/null; then
        kill "$CHROMIUM_PID" 2>/dev/null || true
    fi
    
    log "Shutdown complete"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

check_dependencies() {
    local missing=()
    
    if ! command -v node &>/dev/null; then
        missing+=("node")
    fi
    
    if [[ ! -f "$WHISPER_PATH" ]] && ! command -v whisper &>/dev/null; then
        warn "whisper.cpp not found at $WHISPER_PATH"
    fi
    
    if [[ ! -f "$PIPER_PATH" ]] && ! command -v piper &>/dev/null; then
        warn "Piper not found at $PIPER_PATH"
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing dependencies: ${missing[*]}"
    fi
}

wait_for_server() {
    local max_attempts=30
    local attempt=0
    
    info "Waiting for server to start..."
    
    while [[ $attempt -lt $max_attempts ]]; do
        if curl -s "http://localhost:$PORT/health" >/dev/null 2>&1; then
            log "Server is ready"
            return 0
        fi
        sleep 0.5
        ((attempt++))
    done
    
    error "Server failed to start"
}

start_server() {
    info "Starting OpenClaw server on port $PORT..."
    
    cd "$PROJECT_DIR"
    
    if [[ ! -d "node_modules" ]]; then
        info "Installing dependencies..."
        npm install --production
    fi
    
    node server/index.js &
    SERVER_PID=$!
    
    wait_for_server
}

start_kiosk() {
    if [[ "$KIOSK" != "true" ]]; then
        info "Kiosk mode disabled"
        return 0
    fi
    
    if [[ -z "$DISPLAY" ]]; then
        warn "No DISPLAY set, skipping kiosk"
        return 0
    fi
    
    if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
        warn "Chromium not found, skipping kiosk"
        return 0
    fi
    
    info "Starting Chromium kiosk..."
    
    xset s off 2>/dev/null || true
    xset -dpms 2>/dev/null || true
    xset s noblank 2>/dev/null || true
    
    if command -v unclutter &>/dev/null; then
        unclutter -idle 0.5 -root &
    fi
    
    local CHROMIUM_CMD="chromium-browser"
    command -v chromium-browser &>/dev/null || CHROMIUM_CMD="chromium"
    
    $CHROMIUM_CMD \
        --kiosk \
        --noerrdialogs \
        --disable-infobars \
        --disable-session-crashed-bubble \
        --disable-restore-session-state \
        --disable-translate \
        --no-first-run \
        --fast \
        --fast-start \
        --disable-features=TranslateUI \
        --disk-cache-dir=/dev/null \
        --overscroll-history-navigation=0 \
        --disable-pinch \
        --window-size=480,320 \
        --window-position=0,0 \
        "http://localhost:$PORT" &
    
    CHROMIUM_PID=$!
    log "Chromium kiosk started (PID: $CHROMIUM_PID)"
}

main() {
    echo ""
    echo "╔═══════════════════════════════════════════╗"
    echo "║     OpenClaw Pi Assistant                 ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    
    check_dependencies
    
    info "Configuration:"
    echo "  Port:         $PORT"
    echo "  Kiosk:        $KIOSK"
    echo "  Whisper:      $WHISPER_PATH"
    echo "  Piper:        $PIPER_PATH"
    echo "  Ollama:       $OLLAMA_HOST"
    echo "  Model:        $OLLAMA_MODEL"
    echo ""
    
    start_server
    start_kiosk
    
    log "OpenClaw is running!"
    info "Web UI: http://localhost:$PORT"
    info "Press Ctrl+C to stop"
    echo ""
    
    wait $SERVER_PID
}

usage() {
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --no-kiosk    Don't start Chromium kiosk"
    echo "  --port PORT   Server port (default: 3001)"
    echo "  --help        Show this help"
    echo ""
    echo "Environment variables:"
    echo "  PORT          Server port"
    echo "  KIOSK         Enable kiosk mode (true/false)"
    echo "  WHISPER_PATH  Path to whisper binary"
    echo "  WHISPER_MODEL Path to whisper model"
    echo "  PIPER_PATH    Path to piper binary"
    echo "  PIPER_MODEL   Path to piper voice model"
    echo "  OLLAMA_HOST   Ollama API URL"
    echo "  OLLAMA_MODEL  Model name"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --no-kiosk)
            KIOSK="false"
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            warn "Unknown option: $1"
            shift
            ;;
    esac
done

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
