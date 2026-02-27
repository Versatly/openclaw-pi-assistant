// TTS — via OpenClaw gateway or platform fallback
// On Pi: OpenClaw gateway handles TTS (ElevenLabs, etc)
// Dev: macOS say as fallback
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';

const execFileAsync = promisify(execFile);

const OPENCLAW_HOST = process.env.OPENCLAW_HOST || '127.0.0.1';
const OPENCLAW_PORT = process.env.OPENCLAW_PORT || '18789';
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '';

export async function synthesize(text) {
  if (!text || !text.trim()) return null;

  // Truncate long responses for TTS
  const ttsText = text.length > 500 ? text.slice(0, 500) + '...' : text;

  // Try OpenClaw TTS first
  try {
    return await synthesizeOpenClaw(ttsText);
  } catch (err) {
    console.warn('OpenClaw TTS failed, using fallback:', err.message);
  }

  // macOS fallback
  if (process.platform === 'darwin') {
    return await synthesizeMacOS(ttsText);
  }

  // espeak fallback (Pi without OpenClaw TTS)
  try {
    const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
    const outPath = join(dir, 'speech.wav');
    await execFileAsync('espeak-ng', ['-w', outPath, ttsText], { timeout: 15000 });
    return outPath;
  } catch {}

  console.warn('No TTS available');
  return null;
}

async function synthesizeOpenClaw(text) {
  // OpenClaw /v1/audio/speech endpoint (OpenAI-compatible)
  const body = JSON.stringify({ input: text, voice: 'alloy' });
  const url = `http://${OPENCLAW_HOST}:${OPENCLAW_PORT}/v1/audio/speech`;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(OPENCLAW_TOKEN ? { 'Authorization': `Bearer ${OPENCLAW_TOKEN}` } : {}),
      },
    }, async (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`TTS ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
        const outPath = join(dir, 'speech.mp3');
        await writeFile(outPath, Buffer.concat(chunks));
        resolve(outPath);
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function synthesizeMacOS(text) {
  const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
  const outPath = join(dir, 'speech.aiff');
  await execFileAsync('say', ['-o', outPath, text], { timeout: 15000 });
  return outPath;
}
