// OpenClaw Pi Assistant — Client
(() => {
  'use strict';

  // ── State ──
  let state = 'idle'; // idle | listening | thinking | speaking | error
  let ws = null;
  let reconnectTimer = null;
  const WS_URL = `ws://${location.host}`;

  // ── DOM ──
  const $ = (s) => document.querySelector(s);
  const app = $('#app');
  const statusIcon = $('#status-icon');
  const statusText = $('#status-text');
  const clock = $('#clock');
  const userText = $('#user-text');
  const botText = $('#bot-text');
  const tapZone = $('#tap-zone');
  const toast = $('#toast');
  const confirmOverlay = $('#confirm-overlay');
  const confirmMsg = $('#confirm-msg');
  const btnYes = $('#btn-yes');
  const btnNo = $('#btn-no');

  // ── Clock ──
  function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }
  updateClock();
  setInterval(updateClock, 10000);

  // ── State Machine ──
  function setState(newState, opts = {}) {
    state = newState;
    app.className = `state-${state}`;

    const statusMap = {
      idle: ['🐾', 'Tap to talk'],
      listening: ['🎙️', 'Listening...'],
      thinking: ['🧠', 'Thinking...'],
      speaking: ['🔊', 'Speaking...'],
      error: ['⚠️', opts.error || 'Oops'],
    };

    const [icon, text] = statusMap[state] || ['🐾', '...'];
    statusIcon.textContent = icon;
    statusText.textContent = text;

    if (state === 'idle') {
      // Gentle greeting after speaking
      if (opts.afterSpeak) {
        statusText.textContent = 'Done! Tap to talk again';
      }
    }
  }

  // ── Text Display ──
  function showUserText(text) {
    userText.textContent = `"${text}"`;
    userText.classList.add('visible');
  }

  function showBotText(text) {
    botText.textContent = text;
    botText.classList.add('visible');
  }

  function clearText() {
    userText.classList.remove('visible');
    botText.classList.remove('visible');
    setTimeout(() => {
      userText.textContent = '';
      botText.textContent = '';
    }, 400);
  }

  // ── Streaming text (typewriter) ──
  let streamBuffer = '';
  let streamInterval = null;

  function startStreamText() {
    streamBuffer = '';
    botText.textContent = '';
    botText.classList.add('visible');
  }

  function appendStreamText(chunk) {
    streamBuffer += chunk;
    // Type it out smoothly
    if (!streamInterval) {
      let i = botText.textContent.length;
      streamInterval = setInterval(() => {
        if (i < streamBuffer.length) {
          botText.textContent = streamBuffer.slice(0, i + 1);
          i++;
        } else {
          clearInterval(streamInterval);
          streamInterval = null;
        }
      }, 25);
    }
  }

  function finishStreamText() {
    if (streamInterval) {
      clearInterval(streamInterval);
      streamInterval = null;
    }
    botText.textContent = streamBuffer;
  }

  // ── Toast ──
  function showToast(msg, duration = 2500) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, duration);
  }

  // ── Confirm Dialog ──
  function confirm(msg) {
    return new Promise((resolve) => {
      confirmMsg.textContent = msg;
      confirmOverlay.classList.remove('hidden');
      tapZone.style.pointerEvents = 'none';

      function cleanup(result) {
        confirmOverlay.classList.add('hidden');
        tapZone.style.pointerEvents = '';
        btnYes.removeEventListener('click', onYes);
        btnNo.removeEventListener('click', onNo);
        resolve(result);
      }

      function onYes(e) { e.stopPropagation(); cleanup(true); }
      function onNo(e) { e.stopPropagation(); cleanup(false); }

      btnYes.addEventListener('click', onYes);
      btnNo.addEventListener('click', onNo);
    });
  }

  // Expose for server-triggered confirms
  window.appConfirm = confirm;

  // ── Ripple Effect ──
  function ripple(x, y) {
    const el = document.createElement('div');
    el.className = 'ripple';
    el.style.left = `${x - 25}px`;
    el.style.top = `${y - 25}px`;
    el.style.width = '50px';
    el.style.height = '50px';
    app.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  // ── Tap Handler ──
  tapZone.addEventListener('pointerdown', async (e) => {
    ripple(e.clientX, e.clientY);

    if (state === 'idle' || state === 'error') {
      // Start recording
      clearText();
      setState('listening');
      wsSend({ type: 'start_recording' });
    } else if (state === 'listening') {
      // Stop recording
      setState('thinking');
      wsSend({ type: 'stop_recording' });
    } else if (state === 'speaking') {
      // Interrupt
      wsSend({ type: 'stop_speaking' });
      setState('idle');
    }
  });

  // ── WebSocket ──
  function wsConnect() {
    if (ws && ws.readyState <= 1) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WS connected');
      showToast('Connected ✓');
      setState('idle');
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleMessage(msg);
      } catch (err) {
        console.warn('Bad WS message', err);
      }
    };

    ws.onclose = () => {
      console.log('WS closed');
      showToast('Reconnecting...');
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function wsSend(data) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      wsConnect();
    }, 2000);
  }

  // ── Message Handler ──
  function handleMessage(msg) {
    switch (msg.type) {
      case 'state':
        setState(msg.state, msg);
        break;

      case 'transcript':
        showUserText(msg.text);
        setState('thinking');
        break;

      case 'response_start':
        setState('speaking');
        startStreamText();
        break;

      case 'response_chunk':
        appendStreamText(msg.text);
        break;

      case 'response_done':
        finishStreamText();
        // Stay in speaking until audio finishes
        break;

      case 'audio_done':
        setState('idle', { afterSpeak: true });
        break;

      case 'confirm':
        confirm(msg.text).then((yes) => {
          wsSend({ type: 'confirm_response', id: msg.id, confirmed: yes });
        });
        break;

      case 'toast':
        showToast(msg.text, msg.duration);
        break;

      case 'error':
        setState('error', { error: msg.text || 'Something went wrong' });
        showToast(msg.text || 'Error', 3000);
        setTimeout(() => {
          if (state === 'error') setState('idle');
        }, 4000);
        break;

      default:
        console.log('Unknown message:', msg);
    }
  }

  // ── Init ──
  setState('idle');
  wsConnect();

  // Prevent zoom/scroll on touch
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // Wake lock (keep screen on)
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        await navigator.wakeLock.request('screen');
      }
    } catch (e) { /* ignore */ }
  }
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
})();
