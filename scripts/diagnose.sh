#!/bin/bash
# Quick hardware diagnostic for Pi Assistant
echo "🔍 OpenClaw Pi Assistant — Diagnostics"
echo "======================================="
echo ""

echo "── System ──"
uname -a
echo ""

echo "── Sound Cards ──"
echo "Playback:"
aplay -l 2>&1
echo ""
echo "Capture:"
arecord -l 2>&1
echo ""

echo "── ALSA Config ──"
cat /etc/asound.conf 2>/dev/null || echo "(no /etc/asound.conf)"
echo ""

echo "── I2S/Audio Overlays ──"
grep -E "hifiberry|i2s|audio|pitft|spi" /boot/firmware/config.txt 2>/dev/null || echo "(no boot config found)"
echo ""

echo "── Display ──"
ls /dev/fb* 2>/dev/null || echo "No framebuffer devices"
echo ""

echo "── Whisper ──"
if command -v whisper-cli &>/dev/null; then
  echo "whisper-cli: $(which whisper-cli)"
elif [ -f "$HOME/whisper.cpp/build/bin/whisper-cli" ]; then
  echo "whisper-cli: $HOME/whisper.cpp/build/bin/whisper-cli"
else
  echo "whisper: NOT FOUND"
fi
echo ""

echo "── Node.js ──"
node --version 2>/dev/null || echo "Node: NOT FOUND"
echo ""

echo "── Network ──"
hostname -I 2>/dev/null || ip addr show | grep "inet " | grep -v 127.0.0.1
echo ""

echo "── OpenClaw Gateway Test ──"
OPENCLAW_HOST="${OPENCLAW_HOST:-127.0.0.1}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
if curl -s --connect-timeout 3 "http://${OPENCLAW_HOST}:${OPENCLAW_PORT}/health" >/dev/null 2>&1; then
  echo "Gateway at ${OPENCLAW_HOST}:${OPENCLAW_PORT}: ✓ reachable"
else
  echo "Gateway at ${OPENCLAW_HOST}:${OPENCLAW_PORT}: ✗ unreachable"
fi
echo ""

echo "── Quick Mic Test (3s) ──"
echo "Recording 3 seconds..."
arecord -D plughw:0,0 -f S32_LE -r 48000 -c 1 -d 3 /tmp/oc-mic-test.wav 2>&1
if [ -f /tmp/oc-mic-test.wav ]; then
  echo "✓ Recorded /tmp/oc-mic-test.wav ($(du -h /tmp/oc-mic-test.wav | cut -f1))"
  echo "Play with: aplay /tmp/oc-mic-test.wav"
else
  echo "✗ Recording failed"
fi
