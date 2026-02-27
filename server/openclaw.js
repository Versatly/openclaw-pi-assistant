// OpenClaw Gateway Client
// The Pi talks to OpenClaw — OpenClaw handles LLM, memory, tools, everything.
// Pi sends messages, OpenClaw routes to the configured model (Claude, GPT, etc).
import http from 'http';
import https from 'https';

const OPENCLAW_HOST = process.env.OPENCLAW_HOST || '127.0.0.1';
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || '18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

// OpenClaw exposes an OpenAI-compatible /v1/chat/completions endpoint
const ENDPOINT = `http://${OPENCLAW_HOST}:${OPENCLAW_PORT}/v1/chat/completions`;

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ||
  'You are a helpful, concise voice assistant running on a Raspberry Pi. Keep responses short and conversational — 1-3 sentences max. You are powered by OpenClaw and ClawVault.';

export async function chat(message, history, onChunk) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-18),
  ];

  const body = JSON.stringify({
    messages,
    stream: true,
  });

  const url = new URL(ENDPOINT);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(OPENCLAW_TOKEN ? { 'Authorization': `Bearer ${OPENCLAW_TOKEN}` } : {}),
      },
    };

    const req = transport.request(opts, (res) => {
      let fullResponse = '';
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') {
            resolve(fullResponse);
            return;
          }
          try {
            const data = JSON.parse(payload);
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) {
              fullResponse += delta;
              onChunk(delta);
            }
          } catch {}
        }
      });

      res.on('end', () => resolve(fullResponse));
      res.on('error', reject);
    });

    req.on('error', (err) => {
      reject(new Error(`OpenClaw connection failed: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}
