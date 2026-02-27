#!/bin/bash
set -euo pipefail

echo "🐾 OpenClaw Pi Assistant — Setup"
echo "================================"

# Colors
G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
ok() { echo -e "${G}✓${N} $1"; }
info() { echo -e "${Y}→${N} $1"; }
err() { echo -e "${R}✗${N} $1"; }

# Must be on Pi / arm64 Linux (or force with --force)
if [[ "$(uname -m)" != "aarch64" && "$*" != *--force* ]]; then
  err "This script is for Raspberry Pi (aarch64). Use --force to override."
  exit 1
fi

info "Updating packages..."
sudo apt-get update -qq

# ── Node.js 22 ──
if command -v node &>/dev/null && node --version | grep -q "v22"; then
  ok "Node.js $(node --version) already installed"
else
  info "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
  sudo apt-get install -y nodejs
  ok "Node.js $(node --version) installed"
fi

# ── ALSA utils ──
info "Installing ALSA utilities..."
sudo apt-get install -y alsa-utils
ok "ALSA utils installed"

# ── Sox (dev/test recording helper) ──
sudo apt-get install -y sox libsox-fmt-all 2>/dev/null || true

# ── whisper.cpp ──
WHISPER_DIR="$HOME/whisper.cpp"
if [ -f "$WHISPER_DIR/build/bin/whisper-cli" ]; then
  ok "whisper.cpp already built"
else
  info "Building whisper.cpp (ARM NEON optimized)..."
  sudo apt-get install -y build-essential cmake
  git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR" 2>/dev/null || true
  cd "$WHISPER_DIR"
  git pull --ff-only
  cmake -B build -DCMAKE_BUILD_TYPE=Release
  cmake --build build -j$(nproc)
  ok "whisper.cpp built"

  # Download base.en model
  if [ ! -f "$WHISPER_DIR/models/ggml-base.en.bin" ]; then
    info "Downloading whisper base.en model (~140MB)..."
    bash "$WHISPER_DIR/models/download-ggml-model.sh" base.en
    ok "Model downloaded"
  fi
fi

# ── Piper TTS ──
PIPER_DIR="$HOME/piper"
if [ -f "$PIPER_DIR/piper" ]; then
  ok "Piper TTS already installed"
else
  info "Installing Piper TTS..."
  mkdir -p "$PIPER_DIR"
  cd "$PIPER_DIR"
  # ARM64 release
  PIPER_VER="2023.11.14-2"
  wget -q "https://github.com/rhasspy/piper/releases/download/${PIPER_VER}/piper_linux_aarch64.tar.gz" -O piper.tar.gz
  tar xzf piper.tar.gz --strip-components=1
  rm piper.tar.gz
  ok "Piper installed"

  # Download voice model
  info "Downloading Piper voice model (~90MB)..."
  mkdir -p models
  wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" -O models/en_US-lessac-medium.onnx
  wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" -O models/en_US-lessac-medium.onnx.json
  ok "Voice model downloaded"
fi

# ── ALSA config ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

info "Installing ALSA config..."
sudo cp "$PROJECT_DIR/config/asound.conf" /etc/asound.conf
ok "ALSA config installed"

# ── Boot config ──
info "Checking boot config..."
BOOT_CFG="/boot/firmware/config.txt"
if ! grep -q "hifiberry-dac" "$BOOT_CFG" 2>/dev/null; then
  info "Adding I2S overlays to boot config..."
  echo "" | sudo tee -a "$BOOT_CFG"
  echo "# OpenClaw Pi Assistant — I2S audio" | sudo tee -a "$BOOT_CFG"
  echo "dtoverlay=hifiberry-dac" | sudo tee -a "$BOOT_CFG"
  echo "dtoverlay=i2s-mmap" | sudo tee -a "$BOOT_CFG"
  echo "dtparam=audio=off" | sudo tee -a "$BOOT_CFG"
  ok "Boot config updated (REBOOT REQUIRED)"
else
  ok "Boot config already has I2S overlays"
fi

# ── SPI for TFT ──
if ! grep -q "dtparam=spi=on" "$BOOT_CFG" 2>/dev/null; then
  echo "dtparam=spi=on" | sudo tee -a "$BOOT_CFG"
  ok "SPI enabled"
fi

# ── Chromium ──
if command -v chromium-browser &>/dev/null; then
  ok "Chromium already installed"
else
  info "Installing Chromium..."
  sudo apt-get install -y chromium-browser
  ok "Chromium installed"
fi

# ── npm install ──
info "Installing npm packages..."
cd "$PROJECT_DIR"
npm install
ok "npm packages installed"

# ── Systemd service ──
info "Installing systemd service..."
sudo cp "$PROJECT_DIR/systemd/openclaw-assistant.service" /etc/systemd/system/
sudo systemctl daemon-reload
ok "Systemd service installed"

# ── Environment ──
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << ENVEOF
# OpenClaw Pi Assistant config
PORT=3001
WHISPER_PATH=$HOME/whisper.cpp/build/bin/whisper-cli
WHISPER_MODEL=$HOME/whisper.cpp/models/ggml-base.en.bin
PIPER_PATH=$HOME/piper/piper
PIPER_MODEL=$HOME/piper/models/en_US-lessac-medium.onnx
ENVEOF
  ok "Created .env file — edit as needed"
fi

echo ""
echo "================================"
echo -e "${G}🐾 Setup complete!${N}"
echo ""
echo "Next steps:"
echo "  1. Reboot if boot config was changed: sudo reboot"
echo "  2. Test audio: arecord -d 3 test.wav && aplay test.wav"
echo "  3. Start: ./scripts/start.sh"
echo "  4. Auto-start: sudo systemctl enable openclaw-assistant"
echo ""
