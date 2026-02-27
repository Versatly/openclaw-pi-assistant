#!/bin/bash
set -e

# OpenClaw Pi Assistant - Full Setup Script
# For Raspberry Pi 5 with 3.5" TFT, SPH0645 mic, PCM5102A DAC

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOME_DIR="${HOME:-/home/pi}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
info() { echo -e "${BLUE}[i]${NC} $1"; }

check_pi() {
    if [[ ! -f /proc/device-tree/model ]]; then
        warn "Not running on Raspberry Pi - some steps will be skipped"
        return 1
    fi
    local model=$(cat /proc/device-tree/model 2>/dev/null || echo "")
    if [[ "$model" == *"Raspberry Pi"* ]]; then
        log "Detected: $model"
        return 0
    fi
    warn "Not a Raspberry Pi - some steps will be skipped"
    return 1
}

IS_PI=false
check_pi && IS_PI=true

# ============================================
# System Updates
# ============================================
section_system() {
    info "Updating system packages..."
    sudo apt-get update
    sudo apt-get upgrade -y
    sudo apt-get install -y \
        git curl wget build-essential cmake \
        alsa-utils libasound2-dev \
        chromium-browser \
        unclutter xdotool \
        libffi-dev libssl-dev
    log "System packages installed"
}

# ============================================
# Node.js 22
# ============================================
section_node() {
    if command -v node &>/dev/null; then
        local node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$node_version" -ge 20 ]]; then
            log "Node.js $(node --version) already installed"
            return 0
        fi
    fi

    info "Installing Node.js 22..."
    
    if [[ "$(uname -m)" == "aarch64" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi

    log "Node.js $(node --version) installed"
}

# ============================================
# whisper.cpp (ARM NEON optimized)
# ============================================
section_whisper() {
    local WHISPER_DIR="$HOME_DIR/whisper.cpp"
    local WHISPER_MODEL_DIR="$HOME_DIR/.whisper"
    local WHISPER_BIN="/usr/local/bin/whisper"

    if [[ -f "$WHISPER_BIN" ]]; then
        log "whisper.cpp already installed at $WHISPER_BIN"
    else
        info "Building whisper.cpp..."
        
        if [[ -d "$WHISPER_DIR" ]]; then
            cd "$WHISPER_DIR"
            git pull
        else
            git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
            cd "$WHISPER_DIR"
        fi

        mkdir -p build && cd build
        
        if [[ "$(uname -m)" == "aarch64" ]]; then
            cmake .. -DWHISPER_NO_ACCELERATE=ON -DWHISPER_OPENBLAS=OFF
        else
            cmake ..
        fi
        
        cmake --build . --config Release -j$(nproc)
        
        sudo cp bin/main "$WHISPER_BIN"
        sudo chmod +x "$WHISPER_BIN"
        
        log "whisper.cpp built and installed"
    fi

    mkdir -p "$WHISPER_MODEL_DIR"
    
    if [[ ! -f "$WHISPER_MODEL_DIR/ggml-base.en.bin" ]]; then
        info "Downloading whisper base.en model..."
        cd "$WHISPER_DIR"
        bash ./models/download-ggml-model.sh base.en
        mv models/ggml-base.en.bin "$WHISPER_MODEL_DIR/"
        log "Whisper model downloaded"
    else
        log "Whisper model already exists"
    fi
}

# ============================================
# Piper TTS
# ============================================
section_piper() {
    local PIPER_DIR="$HOME_DIR/piper"
    local PIPER_MODEL_DIR="$HOME_DIR/.piper"
    local PIPER_BIN="/usr/local/bin/piper"

    if [[ -f "$PIPER_BIN" ]]; then
        log "Piper already installed at $PIPER_BIN"
    else
        info "Installing Piper TTS..."
        
        mkdir -p "$PIPER_DIR"
        cd "$PIPER_DIR"

        local ARCH="aarch64"
        [[ "$(uname -m)" != "aarch64" ]] && ARCH="x86_64"
        
        local PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_${ARCH}.tar.gz"
        
        if [[ ! -f "piper" ]]; then
            wget -q "$PIPER_URL" -O piper.tar.gz
            tar -xzf piper.tar.gz
            rm piper.tar.gz
        fi
        
        sudo cp piper/piper "$PIPER_BIN"
        sudo chmod +x "$PIPER_BIN"
        
        if [[ -d "piper/lib" ]]; then
            sudo cp -r piper/lib/* /usr/local/lib/ 2>/dev/null || true
            sudo ldconfig
        fi
        
        log "Piper installed"
    fi

    mkdir -p "$PIPER_MODEL_DIR"
    
    if [[ ! -f "$PIPER_MODEL_DIR/en_US-lessac-medium.onnx" ]]; then
        info "Downloading Piper voice model..."
        cd "$PIPER_MODEL_DIR"
        
        wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
        wget -q "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
        
        log "Piper voice model downloaded"
    else
        log "Piper voice model already exists"
    fi
}

# ============================================
# ALSA Configuration
# ============================================
section_alsa() {
    if [[ "$IS_PI" != "true" ]]; then
        warn "Skipping ALSA config (not on Pi)"
        return 0
    fi

    info "Configuring ALSA..."
    
    if [[ -f "$PROJECT_DIR/config/asound.conf" ]]; then
        sudo cp "$PROJECT_DIR/config/asound.conf" /etc/asound.conf
        log "ALSA config installed"
    else
        warn "asound.conf not found in project"
    fi

    if [[ -f "$PROJECT_DIR/config/config.txt.patch" ]]; then
        local BOOT_CONFIG="/boot/firmware/config.txt"
        [[ ! -f "$BOOT_CONFIG" ]] && BOOT_CONFIG="/boot/config.txt"
        
        if ! grep -q "hifiberry-dac" "$BOOT_CONFIG" 2>/dev/null; then
            info "Adding I2S overlay to boot config..."
            echo "" | sudo tee -a "$BOOT_CONFIG"
            echo "# OpenClaw I2S Audio" | sudo tee -a "$BOOT_CONFIG"
            echo "dtoverlay=hifiberry-dac" | sudo tee -a "$BOOT_CONFIG"
            echo "dtoverlay=i2s-mmap" | sudo tee -a "$BOOT_CONFIG"
            echo "dtparam=audio=off" | sudo tee -a "$BOOT_CONFIG"
            log "Boot config updated (reboot required)"
        else
            log "I2S overlay already configured"
        fi
    fi
}

# ============================================
# Chromium Kiosk Setup
# ============================================
section_kiosk() {
    if [[ "$IS_PI" != "true" ]]; then
        warn "Skipping kiosk setup (not on Pi)"
        return 0
    fi

    info "Setting up Chromium kiosk mode..."
    
    mkdir -p "$HOME_DIR/.config/autostart"
    
    cat > "$HOME_DIR/.config/autostart/openclaw-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=OpenClaw Kiosk
Exec=$PROJECT_DIR/scripts/start.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

    cat > "$HOME_DIR/.config/autostart/disable-screensaver.desktop" << EOF
[Desktop Entry]
Type=Application
Name=Disable Screensaver
Exec=xset s off -dpms
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
EOF

    log "Kiosk autostart configured"
}

# ============================================
# Project Setup
# ============================================
section_project() {
    info "Setting up project..."
    
    cd "$PROJECT_DIR"
    
    if [[ -f "package.json" ]]; then
        npm install --production
        log "Node dependencies installed"
    fi

    chmod +x scripts/*.sh 2>/dev/null || true
    
    log "Project setup complete"
}

# ============================================
# Systemd Service
# ============================================
section_systemd() {
    if [[ "$IS_PI" != "true" ]]; then
        warn "Skipping systemd setup (not on Pi)"
        return 0
    fi

    info "Installing systemd service..."
    
    if [[ -f "$PROJECT_DIR/systemd/openclaw-assistant.service" ]]; then
        local SERVICE_FILE="/etc/systemd/system/openclaw-assistant.service"
        
        cat > /tmp/openclaw-assistant.service << EOF
[Unit]
Description=OpenClaw Pi Assistant
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=DISPLAY=:0
Environment=WHISPER_PATH=/usr/local/bin/whisper
Environment=WHISPER_MODEL=$HOME_DIR/.whisper/ggml-base.en.bin
Environment=PIPER_PATH=/usr/local/bin/piper
Environment=PIPER_MODEL=$HOME_DIR/.piper/en_US-lessac-medium.onnx

[Install]
WantedBy=multi-user.target
EOF
        
        sudo mv /tmp/openclaw-assistant.service "$SERVICE_FILE"
        sudo systemctl daemon-reload
        sudo systemctl enable openclaw-assistant
        
        log "Systemd service installed and enabled"
    fi
}

# ============================================
# Main
# ============================================
main() {
    echo ""
    echo "╔═══════════════════════════════════════════╗"
    echo "║     OpenClaw Pi Assistant Setup           ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""

    section_system
    section_node
    section_whisper
    section_piper
    section_alsa
    section_project
    section_kiosk
    section_systemd

    echo ""
    echo "╔═══════════════════════════════════════════╗"
    echo "║           Setup Complete!                 ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    log "All components installed successfully"
    echo ""
    info "Next steps:"
    echo "  1. Reboot to apply audio config: sudo reboot"
    echo "  2. Start manually: ./scripts/start.sh"
    echo "  3. Or enable service: sudo systemctl start openclaw-assistant"
    echo ""
    
    if [[ "$IS_PI" == "true" ]]; then
        warn "A reboot is recommended to apply I2S audio configuration"
        read -p "Reboot now? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo reboot
        fi
    fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
