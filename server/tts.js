import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PIPER_PATH = process.env.PIPER_PATH || '/usr/local/bin/piper';
const PIPER_MODEL = process.env.PIPER_MODEL || join(process.env.HOME || '/home/pi', '.piper', 'en_US-lessac-medium.onnx');

const TTS_OUTPUT_DIR = process.env.TTS_OUTPUT_DIR || join(tmpdir(), 'openclaw-tts');
const SAMPLE_RATE = 22050;

if (!existsSync(TTS_OUTPUT_DIR)) {
  mkdirSync(TTS_OUTPUT_DIR, { recursive: true });
}

export async function synthesize(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('No text to synthesize');
  }

  const cleanedText = cleanTextForTTS(text);
  const piperBin = findPiperBinary();
  const modelPath = findModelPath();

  console.log(`[TTS] Synthesizing: "${cleanedText.slice(0, 50)}..."`);
  console.log(`[TTS] Using piper: ${piperBin}`);
  console.log(`[TTS] Using model: ${modelPath}`);

  const timestamp = Date.now();
  const outputPath = join(TTS_OUTPUT_DIR, `tts_${timestamp}.wav`);

  return new Promise((resolve, reject) => {
    const args = [
      '--model', modelPath,
      '--output_file', outputPath,
    ];

    const configPath = modelPath.replace('.onnx', '.onnx.json');
    if (existsSync(configPath)) {
      args.push('--config', configPath);
    }

    console.log(`[TTS] Running: echo "..." | ${piperBin} ${args.join(' ')}`);

    const proc = spawn(piperBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[TTS] Piper failed (code ${code}): ${stderr}`);
        reject(new Error(`TTS failed: ${stderr || 'Unknown error'}`));
        return;
      }

      if (!existsSync(outputPath)) {
        reject(new Error('TTS output file not created'));
        return;
      }

      console.log(`[TTS] Generated: ${outputPath}`);
      resolve(outputPath);
    });

    proc.on('error', (err) => {
      console.error(`[TTS] Piper error: ${err.message}`);
      reject(new Error(`Failed to run piper: ${err.message}`));
    });

    proc.stdin.write(cleanedText);
    proc.stdin.end();
  });
}

function findPiperBinary() {
  const candidates = [
    PIPER_PATH,
    '/usr/local/bin/piper',
    join(process.env.HOME || '/home/pi', 'piper', 'piper'),
    join(process.env.HOME || '/home/pi', '.local', 'bin', 'piper'),
    '/opt/piper/piper',
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  console.warn(`[TTS] Piper binary not found, using default: ${PIPER_PATH}`);
  return PIPER_PATH;
}

function findModelPath() {
  const candidates = [
    PIPER_MODEL,
    join(process.env.HOME || '/home/pi', '.piper', 'en_US-lessac-medium.onnx'),
    join(process.env.HOME || '/home/pi', 'piper', 'models', 'en_US-lessac-medium.onnx'),
    '/usr/local/share/piper/en_US-lessac-medium.onnx',
    '/opt/piper/models/en_US-lessac-medium.onnx',
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  console.warn(`[TTS] Model not found, using default: ${PIPER_MODEL}`);
  return PIPER_MODEL;
}

function cleanTextForTTS(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`[^`]+`/g, ' code ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' link ')
    .replace(/[<>{}[\]]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()
    .slice(0, 2000);
}

export function checkPiperInstallation() {
  const binary = findPiperBinary();
  const model = findModelPath();
  
  return {
    binaryFound: existsSync(binary),
    binaryPath: binary,
    modelFound: existsSync(model),
    modelPath: model,
    ready: existsSync(binary) && existsSync(model),
  };
}

export function cleanupOldTTSFiles(maxAgeMs = 3600000) {
  try {
    const { readdirSync, statSync } = require('fs');
    const files = readdirSync(TTS_OUTPUT_DIR);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = join(TTS_OUTPUT_DIR, file);
      const stats = statSync(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        unlinkSync(filePath);
        console.log(`[TTS] Cleaned old file: ${file}`);
      }
    }
  } catch (err) {
    console.error(`[TTS] Cleanup error: ${err.message}`);
  }
}
