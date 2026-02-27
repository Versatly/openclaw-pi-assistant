(function() {
  'use strict';

  const WS_URL = `ws://${window.location.hostname}:3001`;
  const RECONNECT_DELAY = 2000;
  const MAX_RECONNECT_DELAY = 30000;

  let ws = null;
  let reconnectAttempts = 0;
  let isRecording = false;
  let currentState = 'idle';

  const elements = {
    orb: document.getElementById('orb'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    clock: document.getElementById('clock'),
    transcript: document.getElementById('transcript'),
    transcriptText: document.getElementById('transcript-text'),
    response: document.getElementById('response'),
    responseText: document.getElementById('response-text'),
    hint: document.getElementById('hint'),
    tapZone: document.getElementById('tap-zone'),
    errorToast: document.getElementById('error-toast'),
    errorMessage: document.getElementById('error-message'),
  };

  function init() {
    updateClock();
    setInterval(updateClock, 1000);
    
    connect();
    
    elements.tapZone.addEventListener('click', handleTap);
    elements.tapZone.addEventListener('touchstart', handleTouchStart, { passive: true });
    elements.tapZone.addEventListener('touchend', handleTouchEnd, { passive: true });
    
    document.addEventListener('keydown', handleKeyDown);
  }

  function connect() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    console.log('[WS] Connecting to', WS_URL);
    
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.error('[WS] Failed to create WebSocket:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[WS] Connected');
      reconnectAttempts = 0;
      setConnectionStatus(true);
    };

    ws.onclose = (event) => {
      console.log('[WS] Disconnected:', event.code, event.reason);
      setConnectionStatus(false);
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (err) {
        console.error('[WS] Invalid message:', err);
      }
    };
  }

  function scheduleReconnect() {
    reconnectAttempts++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    setTimeout(connect, delay);
  }

  function send(type, data = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected');
      showError('Not connected to server');
      return false;
    }
    ws.send(JSON.stringify({ type, ...data }));
    return true;
  }

  function handleMessage(data) {
    console.log('[WS] Received:', data.type);

    switch (data.type) {
      case 'connected':
        console.log('[WS] Client ID:', data.clientId);
        break;

      case 'recording_started':
        isRecording = true;
        setState('recording');
        break;

      case 'recording_stopped':
        isRecording = false;
        break;

      case 'state':
        setState(data.state);
        break;

      case 'transcript':
        showTranscript(data.text);
        break;

      case 'response_chunk':
        appendResponse(data.text);
        break;

      case 'response_complete':
        break;

      case 'error':
        showError(data.message);
        setState('idle');
        isRecording = false;
        break;

      case 'history_cleared':
        clearTexts();
        break;
    }
  }

  function handleTap(event) {
    event.preventDefault();
    toggleRecording();
  }

  let touchStartTime = 0;
  
  function handleTouchStart(event) {
    touchStartTime = Date.now();
  }

  function handleTouchEnd(event) {
    const touchDuration = Date.now() - touchStartTime;
    if (touchDuration < 500) {
      toggleRecording();
    }
  }

  function handleKeyDown(event) {
    if (event.code === 'Space' || event.key === ' ') {
      event.preventDefault();
      toggleRecording();
    }
  }

  function toggleRecording() {
    if (currentState === 'thinking' || currentState === 'speaking' || currentState === 'transcribing') {
      return;
    }

    if (isRecording) {
      send('stop_recording');
    } else {
      clearTexts();
      send('start_recording');
    }
  }

  function setState(state) {
    currentState = state;
    
    elements.orb.className = '';
    if (state !== 'idle') {
      elements.orb.classList.add(state);
    }

    const stateLabels = {
      idle: 'Ready',
      recording: 'Listening...',
      transcribing: 'Processing...',
      thinking: 'Thinking...',
      speaking: 'Speaking...',
    };

    elements.statusText.textContent = stateLabels[state] || 'Ready';

    if (state === 'recording') {
      elements.hint.textContent = 'Tap to stop';
      elements.hint.classList.add('recording');
    } else {
      elements.hint.textContent = 'Tap anywhere to talk';
      elements.hint.classList.remove('recording');
    }
  }

  function setConnectionStatus(connected) {
    if (connected) {
      elements.statusDot.classList.remove('disconnected');
      elements.statusText.textContent = 'Ready';
    } else {
      elements.statusDot.classList.add('disconnected');
      elements.statusText.textContent = 'Disconnected';
    }
  }

  function showTranscript(text) {
    elements.transcriptText.textContent = text;
    elements.transcript.classList.remove('hidden');
  }

  function appendResponse(text) {
    elements.response.classList.remove('hidden');
    elements.responseText.textContent += text;
  }

  function clearTexts() {
    elements.transcript.classList.add('hidden');
    elements.response.classList.add('hidden');
    elements.transcriptText.textContent = '';
    elements.responseText.textContent = '';
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorToast.classList.remove('hidden');
    
    setTimeout(() => {
      elements.errorToast.classList.add('hidden');
    }, 4000);
  }

  function updateClock() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    elements.clock.textContent = `${displayHours}:${minutes} ${ampm}`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
