#!/bin/bash
# Hardware validation suite for OpenClaw Pi Assistant
# Run each test independently — pass/fail per component
set -u

G='\033[0;32m'; R='\033[0;31m'; Y='\033[1;33m'; B='\033[1;34m'; N='\033[0m'
PASS=0; FAIL=0; SKIP=0

pass() { echo -e "  ${G}PASS${N} $1"; ((PASS++)); }
fail() { echo -e "  ${R}FAIL${N} $1"; ((FAIL++)); }
skip() { echo -e "  ${Y}SKIP${N} $1"; ((SKIP++)); }
header() { echo -e "\n${B}━━ $1 ━━${N}"; }

echo "==============================================="
echo "  OpenClaw Pi Assistant — Hardware Test Suite"
echo "  $(date)"
echo "==============================================="

# ── 1. SYSTEM INFO ──
header "1. System Info"
echo "  Kernel: $(uname -r)"
echo "  Arch: $(uname -m)"
echo "  Model: $(cat /proc/device-tree/model 2>/dev/null || echo 'unknown')"
echo "  Memory: $(free -h | awk '/Mem:/{print $2}') total"
echo "  Temp: $(vcgencmd measure_temp 2>/dev/null || echo 'n/a')"

if [[ "$(uname -m)" == "aarch64" ]]; then
  pass "Running on ARM64 (Pi compatible)"
else
  fail "Not ARM64 — expected aarch64, got $(uname -m)"
fi

# ── 2. SPI BUS ──
header "2. SPI Bus (for TFT display)"
if ls /dev/spidev* 2>/dev/null | head -1 >/dev/null; then
  echo "  Devices: $(ls /dev/spidev* 2>/dev/null | tr '\n' ' ')"
  pass "SPI enabled and devices present"
else
  if grep -q "dtparam=spi=on" /boot/firmware/config.txt 2>/dev/null; then
    fail "SPI enabled in config but no /dev/spidev* — reboot needed?"
  else
    fail "SPI not enabled. Add 'dtparam=spi=on' to /boot/firmware/config.txt"
  fi
fi

# ── 3. I2C BUS ──
header "3. I2C Bus"
if ls /dev/i2c-* 2>/dev/null | head -1 >/dev/null; then
  echo "  Devices: $(ls /dev/i2c-* 2>/dev/null | tr '\n' ' ')"
  pass "I2C bus available"
  if command -v i2cdetect &>/dev/null; then
    echo "  Scanning I2C bus 1..."
    i2cdetect -y 1 2>/dev/null | head -10
  fi
else
  skip "I2C not enabled (optional — not needed if only using SPI)"
fi

# ── 4. GPIO ACCESS ──
header "4. GPIO Access"
if [ -d /sys/class/gpio ] || [ -c /dev/gpiochip0 ]; then
  pass "GPIO subsystem available"
  if command -v gpiodetect &>/dev/null; then
    echo "  Chips:"
    gpiodetect 2>/dev/null | head -5
  elif command -v pinctrl &>/dev/null; then
    echo "  Using pinctrl (Pi 5 style):"
    pinctrl get 2>/dev/null | head -10
  fi
else
  fail "GPIO not accessible"
fi

if command -v gpioinfo &>/dev/null; then
  pass "libgpiod tools installed"
else
  skip "libgpiod tools not installed (sudo apt install gpiod)"
fi

# ── 5. TFT DISPLAY ──
header "5. TFT Display (3.5\" SPI)"

if ls /dev/fb* 2>/dev/null | head -1 >/dev/null; then
  echo "  Framebuffers: $(ls /dev/fb* 2>/dev/null | tr '\n' ' ')"
  pass "Framebuffer device present"
  if [ -f /sys/class/graphics/fb0/virtual_size ]; then
    echo "  Resolution: $(cat /sys/class/graphics/fb0/virtual_size)"
  fi
  if [ -e /dev/fb1 ]; then
    pass "Secondary framebuffer (fb1) found — likely TFT"
  else
    skip "No fb1 — TFT may use fb0 or DRM/KMS"
  fi
else
  fail "No framebuffer devices found"
fi

if ls /dev/dri/card* 2>/dev/null | head -1 >/dev/null; then
  echo "  DRM devices: $(ls /dev/dri/card* 2>/dev/null | tr '\n' ' ')"
  pass "DRM/KMS available"
fi

if grep -q "pitft\|ili9\|fbtft\|waveshare\|tft" /boot/firmware/config.txt 2>/dev/null; then
  echo "  TFT overlay in config.txt:"
  grep -E "pitft|ili9|fbtft|waveshare|tft" /boot/firmware/config.txt
  pass "TFT overlay configured"
else
  fail "No TFT overlay in /boot/firmware/config.txt"
fi

# ── 6. TOUCH INPUT ──
header "6. Touch Input"
if ls /dev/input/event* 2>/dev/null | head -1 >/dev/null; then
  echo "  Input devices:"
  for ev in /dev/input/event*; do
    evbase=$(basename "$ev")
    name=$(cat /sys/class/input/${evbase}/../name 2>/dev/null || echo "unknown")
    echo "    $ev: $name"
  done
  pass "Input event devices found"
else
  fail "No input event devices"
fi

# ── 7. I2S AUDIO OUTPUT (PCM5102A DAC) ──
header "7. I2S Audio Output (PCM5102A DAC)"

if grep -q "hifiberry-dac\|pcm5102\|i2s" /boot/firmware/config.txt 2>/dev/null; then
  echo "  I2S overlay in config.txt:"
  grep -E "hifiberry|pcm5102|i2s" /boot/firmware/config.txt
  pass "I2S DAC overlay configured"
else
  fail "No I2S DAC overlay in config.txt. Add: dtoverlay=hifiberry-dac"
fi

echo "  Playback devices:"
aplay -l 2>/dev/null
if aplay -l 2>/dev/null | grep -qi "hifiberry\|i2s\|card"; then
  pass "ALSA playback devices found"
else
  fail "No ALSA playback devices — DAC not detected"
fi

echo ""
echo "  Generating 440Hz test tone (2 seconds)..."
if command -v speaker-test &>/dev/null; then
  speaker-test -t sine -f 440 -l 1 -P 2 2>/dev/null &
  SPKPID=$!
  sleep 2
  kill $SPKPID 2>/dev/null
  wait $SPKPID 2>/dev/null
  pass "speaker-test ran (did you hear a tone?)"
else
  skip "speaker-test not available"
fi

# ── 8. I2S MICROPHONE (SPH0645) ──
header "8. I2S Microphone (SPH0645)"

echo "  Capture devices:"
arecord -l 2>/dev/null
if arecord -l 2>/dev/null | grep -qi "card\|i2s\|sph\|mic"; then
  pass "ALSA capture devices found"
else
  fail "No ALSA capture devices — microphone not detected"
fi

echo ""
echo "  Recording 3 seconds..."
TESTFILE="/tmp/oc-hw-mic-test.wav"
rm -f "$TESTFILE"
RECORDED=0

for fmt in S32_LE S16_LE; do
  for rate in 48000 44100 16000; do
    if arecord -D plughw:0,0 -f "$fmt" -r "$rate" -c 1 -d 3 "$TESTFILE" 2>/dev/null; then
      SIZE=$(du -h "$TESTFILE" | cut -f1)
      echo "  Recorded: $TESTFILE ($SIZE) at ${rate}Hz $fmt"
      if command -v sox &>/dev/null; then
        MAX=$(sox "$TESTFILE" -n stat 2>&1 | grep "Maximum amplitude" | awk '{print $3}')
        echo "  Max amplitude: $MAX"
      fi
      pass "Microphone recording succeeded — play with: aplay $TESTFILE"
      RECORDED=1
      break 2
    fi
  done
done

if [ $RECORDED -eq 0 ]; then
  fail "All recording attempts failed — check wiring & dmesg | grep i2s"
fi

# ── 9. ALSA CONFIG ──
header "9. ALSA Configuration"
if [ -f /etc/asound.conf ]; then
  cat /etc/asound.conf | head -20
  pass "ALSA config present"
else
  skip "No /etc/asound.conf (using defaults)"
fi

# ── 10. NETWORK ──
header "10. Network"
hostname -I 2>/dev/null || ip addr show | grep "inet " | grep -v 127.0.0.1
if ping -c 1 -W 2 8.8.8.8 >/dev/null 2>&1; then
  pass "Internet connectivity"
else
  fail "No internet"
fi

# ── 11. KERNEL MESSAGES ──
header "11. Relevant Kernel Messages"
dmesg 2>/dev/null | grep -iE "i2s|spi|audio|hifiberry|fb|tft|ili9|touch|input" | tail -20

# ── SUMMARY ──
echo ""
echo "==============================================="
echo -e "  Results: ${G}$PASS passed${N}  ${R}$FAIL failed${N}  ${Y}$SKIP skipped${N}"
echo "==============================================="

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "Fix FAILs before building the app."
  echo "Common fixes:"
  echo "  - Reboot after config.txt changes"
  echo "  - sudo apt install gpiod evtest i2c-tools sox alsa-utils"
  echo "  - Check wiring: pinctrl (Pi 5) or raspi-gpio (Pi 4)"
  echo "  - I2S debug: dmesg | grep i2s"
  exit 1
fi
exit 0
