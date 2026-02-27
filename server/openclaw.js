// OpenClaw Gateway Client — WebSocket protocol
// Pi connects as operator, uses chat.send/chat.history
// This gives the agent full context (memory, tools, skills)
import WebSocket from 'ws';
import crypto from 'crypto';

const OPENCLAW_HOST = process.env.OPENCLAW_HOST || '127.0.0.1';
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || '18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';
const WS_URL = `ws://${OPENCLAW_HOST}:${OPENCLAW_PORT}`;

let ws = null;
let connected = false;
let reqId = 0;
const pending = new Map(); // id → { resolve, reject, onChunk }
const deviceId = process.env.DEVICE_ID || `pi-assistant-${crypto.randomBytes(4).toString('hex')}`;

function nextId() { return String(++reqId); }

function send(data) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function wsRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pending.set(id, { resolve, reject });
    send({ type: 'req', id, method, params });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 60000);
  });
}

export function connect() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL);
    let challengeNonce = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      // Challenge from gateway
      if (msg.type === 'event' && msg.event === 'connect.challenge') {
        challengeNonce = msg.payload?.nonce;
        // Send connect as operator
        const id = nextId();
        send({
          type: 'req',
          id,
          method: 'connect',
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: 'pi-assistant',
              version: '0.1.0',
              platform: 'linux',
              mode: 'operator',
            },
            role: 'operator',
            scopes: ['operator.read', 'operator.write'],
            caps: [],
            commands: [],
            permissions: {},
            auth: { token: OPENCLAW_TOKEN },
            locale: 'en-US',
            userAgent: 'openclaw-pi-assistant/0.1.0',
            device: {
              id: deviceId,
              nonce: challengeNonce,
            },
          },
        });
        pending.set(id, {
          resolve: () => { connected = true; resolve(); },
          reject,
        });
        return;
      }

      // Response to a request
      if (msg.type === 'res' && msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.ok) res(msg.payload);
        else rej(new Error(msg.error?.message || 'Gateway error'));
        return;
      }

      // Agent response streaming events
      if (msg.type === 'event') {
        handleEvent(msg);
      }
    });

    ws.on('error', (err) => {
      console.error('Gateway WS error:', err.message);
      connected = false;
      reject(err);
    });

    ws.on('close', () => {
      console.log('Gateway WS closed');
      connected = false;
      // Auto reconnect after 3s
      setTimeout(() => connect().catch(() => {}), 3000);
    });
  });
}

// Chat response handler — set by chat() calls
let activeResponseHandler = null;

function handleEvent(msg) {
  if (!activeResponseHandler) return;
  const { onChunk, onDone, onAudio } = activeResponseHandler;

  switch (msg.event) {
    case 'chat.chunk':
    case 'agent.chunk':
      if (msg.payload?.text) onChunk(msg.payload.text);
      break;
    case 'chat.done':
    case 'agent.done':
      onDone(msg.payload?.text || '');
      break;
    case 'chat.audio':
    case 'agent.audio':
      // TTS audio from the agent
      if (msg.payload?.url || msg.payload?.base64) {
        onAudio(msg.payload);
      }
      break;
  }
}

export async function chat(message, history, onChunk) {
  if (!connected) {
    try { await connect(); } catch (err) {
      throw new Error(`Cannot connect to OpenClaw: ${err.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    let fullResponse = '';

    activeResponseHandler = {
      onChunk: (text) => {
        fullResponse += text;
        onChunk(text);
      },
      onDone: (text) => {
        if (text && !fullResponse) fullResponse = text;
        activeResponseHandler = null;
        resolve(fullResponse);
      },
      onAudio: (payload) => {
        // Will be handled by the caller if needed
      },
    };

    // Send via chat.send
    wsRequest('chat.send', { text: message }).catch((err) => {
      activeResponseHandler = null;
      reject(err);
    });

    // Timeout
    setTimeout(() => {
      if (activeResponseHandler) {
        activeResponseHandler = null;
        if (fullResponse) resolve(fullResponse);
        else reject(new Error('Response timeout'));
      }
    }, 45000);
  });
}

export function isConnected() { return connected; }
