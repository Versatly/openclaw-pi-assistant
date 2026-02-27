# OpenClaw Pi Assistant

Voice-first AI assistant for Raspberry Pi 5 with touchscreen. Tap to talk, see responses on screen, hear them through the speaker.

## Hardware

| Component | Model | Interface |
|-----------|-------|-----------|
| Board | Raspberry Pi 5 | — |
| Display | Inland 3.5" TFT (480x320) | SPI + XPT2046 touch |
| Microphone | SPH0645 I2S MEMS | I2S input (DOUT → GPIO20/Pin38) |
| Speaker | Pirate Audio DAC/Amp | I2S output (DIN → GPIO21/Pin40) |

### Pin Mapping

Both mic and Pirate Audio share I2S clock lines:

| Signal | GPIO | Pin | Used By |
|--------|------|-----|---------|
| BCLK | GPIO18 | Pin 12 | Mic + Speaker (shared) |
| LRCK/WS | GPIO19 | Pin 35 | Mic + Speaker (shared) |
| DOUT | GPIO20 | Pin 38 | Mic data out |
| DIN | GPIO21 | Pin 40 | Speaker data in |
| VCC | — | Pin 1 (3.3V) | Mic + Speaker |
| GND | — | Pin 6/9 | Mic + Speaker |
| SEL | — | Pin 6 (GND) | Mic left channel |

**Note:** Pirate Audio may need 5V on Pin 2 for the amplifier.

## Architecture

```
[3.5" TFT Touchscreen — Chromium Kiosk]
        ↕ WebSocket (localhost:3001)
[Node.js Server (Express + WS)]
  ├── arecord 48kHz I2S → whisper.cpp STT
  ├── Piper TTS → aplay I2S (Pirate Audio)
  └── OpenClaw Gateway / Ollama API
```

### Node Mode (recommended)

Pi runs as an OpenClaw **node** connected to a gateway (e.g., Mac Mini):
```
openclaw node run --host <gateway-ip> --port 18789
```

Gateway handles LLM, memory, tools. Pi handles audio I/O and display.

## States

| State | Orb Color | Animation | Mouth |
|-------|-----------|-----------|-------|
| Idle | Blue | Gentle bob | Smile |
| Listening | Red | Pulse | Open circle |
| Thinking | Blue | Wobble + spin | Dot |
| Speaking | Green | Glow | Talking |
| Error | Orange | Static | Frown |

## Quick Start

```bash
# On Pi:
git clone https://github.com/Versatly/openclaw-pi-assistant.git
cd openclaw-pi-assistant
./scripts/setup-pi.sh    # Installs everything
sudo reboot              # Apply boot config
./scripts/start.sh       # Launch
```

## Project Structure

```
server/
  index.js       — Express + WebSocket server
  audio.js       — ALSA record/play (SPH0645 + Pirate Audio)
  stt.js         — whisper.cpp / Python whisper
  tts.js         — Piper TTS / macOS say fallback
  openclaw.js    — Ollama / OpenClaw API client
web/
  index.html     — Touch UI (480x320)
  style.css      — Animated orb + dark theme
  app.js         — WebSocket client + state machine
scripts/
  setup-pi.sh    — Full Pi setup (idempotent)
  start.sh       — Launch server + Chromium kiosk
config/
  asound.conf    — ALSA config for I2S
  config.txt.patch — /boot/firmware/config.txt additions
systemd/
  openclaw-assistant.service
```
