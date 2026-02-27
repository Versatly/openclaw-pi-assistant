// Audio — ALSA record/play helpers (with macOS fallback)
import { spawn } from 'child_process';
import { mkdtemp, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const IS_PI = process.platform === 'linux' && process.arch === 'arm64';

export async function startRecording() {
  const dir = await mkdtemp(join(tmpdir(), 'oc-audio-'));
  const wavPath = join(dir, 'recording.wav');

  let proc;
  if (IS_PI) {
    // ALSA: 16kHz, 16-bit, mono, from I2S mic
    proc = spawn('arecord', [
      '-D', 'plughw:0,0',
      '-f', 'S16_LE',
      '-r', '16000',
      '-c', '1',
      '-t', 'wav',
      wavPath
    ], { stdio: 'ignore' });
  } else {
    // macOS: use sox (brew install sox)
    proc = spawn('sox', [
      '-d',           // default input
      '-r', '16000',
      '-c', '1',
      '-b', '16',
      wavPath
    ], { stdio: 'ignore' });
  }

  proc.on('error', (err) => {
    console.error('Record process error:', err.message);
  });

  return { proc, wavPath };
}

export async function stopRecording(handle) {
  return new Promise((resolve, reject) => {
    if (!handle || !handle.proc) return reject(new Error('No recording'));

    handle.proc.on('close', () => resolve(handle.wavPath));
    handle.proc.on('error', reject);

    // Graceful stop
    if (handle.proc.pid) {
      handle.proc.kill('SIGINT');
      // Force kill after 1s if stuck
      setTimeout(() => {
        try { handle.proc.kill('SIGKILL'); } catch {}
      }, 1000);
    }
  });
}

export async function playAudio(wavPath) {
  return new Promise((resolve, reject) => {
    let proc;
    if (IS_PI) {
      proc = spawn('aplay', ['-D', 'plughw:0,0', wavPath], { stdio: 'ignore' });
    } else {
      proc = spawn('afplay', [wavPath], { stdio: 'ignore' });
    }

    proc.on('close', (code) => {
      // Clean up temp file
      unlink(wavPath).catch(() => {});
      resolve();
    });
    proc.on('error', (err) => {
      console.error('Playback error:', err.message);
      resolve(); // Don't block pipeline on playback errors
    });
  });
}
