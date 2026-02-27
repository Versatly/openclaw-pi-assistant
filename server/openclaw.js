// OpenClaw/Ollama Chat Client
import http from 'http';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 'You are a helpful, concise voice assistant running on a Raspberry Pi. Keep responses short and conversational — 1-3 sentences max. You are powered by OpenClaw and ClawVault.';

export async function chat(message, history, onChunk) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-18), // Keep last 18 + system = 19
    // Current message is already in history
  ];

  // Try Ollama streaming API
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      stream: true,
    });

    const url = new URL(OLLAMA_URL + '/api/chat');
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(opts, (res) => {
      let fullResponse = '';
      let buffer = '';

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullResponse += data.message.content;
              onChunk(data.message.content);
            }
            if (data.done) {
              resolve(fullResponse);
            }
          } catch {}
        }
      });

      res.on('end', () => {
        // Process remaining buffer
        if (buffer.trim()) {
          try {
            const data = JSON.parse(buffer);
            if (data.message?.content) {
              fullResponse += data.message.content;
              onChunk(data.message.content);
            }
          } catch {}
        }
        resolve(fullResponse);
      });

      res.on('error', reject);
    });

    req.on('error', (err) => {
      reject(new Error(`LLM connection failed: ${err.message}`));
    });

    req.write(body);
    req.end();
  });
}
