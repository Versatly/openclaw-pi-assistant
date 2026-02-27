# OpenClaw Pi Assistant

Voice-first AI assistant for Raspberry Pi 5 with touchscreen. Tap to talk, see responses on screen, hear them through the speaker.

## Hardware

| Component | Model | Interface |
|-----------|-------|-----------|
| Board | Raspberry Pi 5 | — |
| Display | Inland 3.5" TFT | SPI |
| Microphone | SPH0645 I2S MEMS | I2S (DOUT → GPIO 20/Pin 38) |
| DAC/Amp | PCM5102A + speaker | I2S (DIN → GPIO 21/Pin 40) |

### Pin Mapping

Both mic and DAC share I2S clock lines:
- **BCLK** → GPIO 18 (Pin 12)
- **LRCK/WS** → GPIO 19 (Pin 35)
- **Mic DOUT** → GPIO 20 (Pin 38)
- **DAC DIN** → GPIO 21 (Pin 40)
- **VCC** → 3.3V (Pin 1), **GND** → Pin 6/9

## Architecture

```
[3.5" TFT Touchscreen — Chromium Kiosk]
        ↕ WebSocket (localhost:3001)
[Node.js Server (Express + WS)]
  ├── arecord (I2S mic) → whisper.cpp (local STT)
  ├── Piper TTS (local) → aplay (I2S DAC)
  └── OpenClaw Gateway API (localhost)
        └── LLM (Ollama local or cloud API)
```

## Flow

1. **Idle** — Pulsing orb, clock/greeting
2. **Tap** — Start recording (orb red, pulsing)
3. **Tap again** — Stop → whisper.cpp transcribes
4. **Think** — Text → OpenClaw → LLM responds
5. **Stream** — Response streams word-by-word on screen
6. **Speak** — Piper TTS → speaker
7. **Idle** — Return

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (480x320 optimized)
- **Backend**: Node.js (Express + ws)
- **STT**: whisper.cpp (ggml-base.en, ~140MB)
- **TTS**: Piper (en_US-lessac-medium, ~90MB)
- **Audio**: ALSA (arecord/aplay for I2S)
- **AI**: OpenClaw gateway (local)
- **Display**: Chromium kiosk mode

## Project Structure

```
server/
  index.js          — Express + WebSocket server
  audio.js          — ALSA record/play helpers
  stt.js            — whisper.cpp integration
  tts.js            — Piper TTS integration
  openclaw.js       — OpenClaw API client
web/
  index.html        — Main UI (480x320)
  style.css         — Touch-optimized styles
  app.js            — WebSocket client + UI logic
scripts/
  setup-pi.sh       — Full Pi setup
  setup-audio.sh    — I2S mic + DAC config
  start.sh          — Launch server + kiosk
config/
  asound.conf       — ALSA config for I2S
  config.txt.patch  — /boot/firmware/config.txt additions
systemd/
  openclaw-assistant.service
```

## Display

- 480x320 pixels (3.5" TFT)
- XPT2046 resistive touch (SPI)
- Large touch targets (60px+), 16px+ fonts
- No scrolling — single-screen UI
