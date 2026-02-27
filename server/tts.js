// TTS — Piper or macOS say fallback
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const execFileAsync = promisify(execFile);

const PIPER_PATH = process.env.PIPER_PATH || 'piper';
const PIPER_MODEL = process.env.PIPER_MODEL || null;
const IS_PI = process.platform === 'linux' && process.arch === 'arm64';

async function which(cmd) {
  try {
    const { stdout } = await execFileAsync('which', [cmd]);
    return stdout.trim();
  } catch { return null; }
}

export async function synthesize(text) {
  if (!text || !text.trim()) return null;

  // Truncate very long responses for TTS
  const maxChars = 500;
  let ttsText = text.length > maxChars ? text.slice(0, maxChars) + '...' : text;

  // Try Piper first (Pi), then macOS say
  const piperBin = await which(PIPER_PATH);
  if (piperBin) {
    return synthesizePiper(piperBin, ttsText);
  }

  // macOS fallback
  if (process.platform === 'darwin') {
    return synthesizeMacOS(ttsText);
  }

  // espeak fallback
  const espeakBin = await which('espeak-ng') || await which('espeak');
  if (espeakBin) {
    return synthesizeEspeak(espeakBin, ttsText);
  }

  console.warn('No TTS engine found');
  return null;
}

async function synthesizePiper(bin, text) {
  const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
  const outPath = join(dir, 'speech.wav');

  const args = ['--output_file', outPath];
  if (PIPER_MODEL) {
    args.push('--model', PIPER_MODEL);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    proc.stdin.write(text);
    proc.stdin.end();
    proc.on('close', (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`Piper exited ${code}`));
    });
    proc.on('error', reject);
  });
}

async function synthesizeMacOS(text) {
  const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
  const outPath = join(dir, 'speech.aiff');

  await execFileAsync('say', ['-o', outPath, text], { timeout: 15000 });
  return outPath;
}

async function synthesizeEspeak(bin, text) {
  const dir = await mkdtemp(join(tmpdir(), 'oc-tts-'));
  const outPath = join(dir, 'speech.wav');

  await execFileAsync(bin, ['-w', outPath, text], { timeout: 15000 });
  return outPath;
}
