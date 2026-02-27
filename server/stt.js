import { spawn } from 'child_process';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

const WHISPER_PATH = process.env.WHISPER_PATH || '/usr/local/bin/whisper';
const WHISPER_MODEL = process.env.WHISPER_MODEL || join(process.env.HOME || '/home/pi', '.whisper', 'ggml-base.en.bin');

const WHISPER_THREADS = process.env.WHISPER_THREADS || '4';
const WHISPER_PROCESSORS = process.env.WHISPER_PROCESSORS || '1';

export async function transcribe(wavPath) {
  if (!existsSync(wavPath)) {
    throw new Error(`WAV file not found: ${wavPath}`);
  }

  const whisperBin = findWhisperBinary();
  const modelPath = findModelPath();

  console.log(`[STT] Transcribing: ${wavPath}`);
  console.log(`[STT] Using whisper: ${whisperBin}`);
  console.log(`[STT] Using model: ${modelPath}`);

  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-f', wavPath,
      '-t', WHISPER_THREADS,
      '-p', WHISPER_PROCESSORS,
      '--no-timestamps',
      '-l', 'en',
      '--output-txt',
    ];

    console.log(`[STT] Running: ${whisperBin} ${args.join(' ')}`);

    const proc = spawn(whisperBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      cleanupWav(wavPath);

      if (code !== 0) {
        console.error(`[STT] Whisper failed (code ${code}): ${stderr}`);
        reject(new Error(`Transcription failed: ${stderr || 'Unknown error'}`));
        return;
      }

      const transcript = parseWhisperOutput(stdout, wavPath);
      console.log(`[STT] Result: "${transcript}"`);
      resolve(transcript);
    });

    proc.on('error', (err) => {
      cleanupWav(wavPath);
      console.error(`[STT] Whisper error: ${err.message}`);
      reject(new Error(`Failed to run whisper: ${err.message}`));
    });
  });
}

function findWhisperBinary() {
  const candidates = [
    WHISPER_PATH,
    '/usr/local/bin/whisper',
    '/usr/local/bin/main',
    join(process.env.HOME || '/home/pi', 'whisper.cpp', 'main'),
    join(process.env.HOME || '/home/pi', 'whisper.cpp', 'build', 'bin', 'main'),
    '/opt/whisper/main',
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  console.warn(`[STT] Whisper binary not found, using default: ${WHISPER_PATH}`);
  return WHISPER_PATH;
}

function findModelPath() {
  const candidates = [
    WHISPER_MODEL,
    join(process.env.HOME || '/home/pi', '.whisper', 'ggml-base.en.bin'),
    join(process.env.HOME || '/home/pi', 'whisper.cpp', 'models', 'ggml-base.en.bin'),
    '/usr/local/share/whisper/ggml-base.en.bin',
    '/opt/whisper/models/ggml-base.en.bin',
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }

  console.warn(`[STT] Model not found, using default: ${WHISPER_MODEL}`);
  return WHISPER_MODEL;
}

function parseWhisperOutput(stdout, wavPath) {
  const txtPath = wavPath.replace('.wav', '.wav.txt');
  if (existsSync(txtPath)) {
    try {
      const content = readFileSync(txtPath, 'utf8');
      unlinkSync(txtPath);
      return cleanTranscript(content);
    } catch (err) {
      console.warn(`[STT] Could not read txt output: ${err.message}`);
    }
  }

  const lines = stdout.split('\n');
  const textLines = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed && 
           !trimmed.startsWith('[') && 
           !trimmed.startsWith('whisper_') &&
           !trimmed.includes('main:') &&
           !trimmed.includes('system_info:');
  });

  return cleanTranscript(textLines.join(' '));
}

function cleanTranscript(text) {
  return text
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '')
    .trim();
}

function cleanupWav(wavPath) {
  try {
    if (existsSync(wavPath)) {
      unlinkSync(wavPath);
      console.log(`[STT] Cleaned up: ${wavPath}`);
    }
  } catch (err) {
    console.warn(`[STT] Cleanup failed: ${err.message}`);
  }
}

export function checkWhisperInstallation() {
  const binary = findWhisperBinary();
  const model = findModelPath();
  
  return {
    binaryFound: existsSync(binary),
    binaryPath: binary,
    modelFound: existsSync(model),
    modelPath: model,
    ready: existsSync(binary) && existsSync(model),
  };
}
