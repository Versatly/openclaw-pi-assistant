// Audio — ALSA record/play helpers (with macOS fallback)
// Hardware: SPH0645 I2S MEMS mic + Pirate Audio DAC/amp
import { spawn } from 'child_process';
import { mkdtemp, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const IS_PI = process.platform === 'linux' && process.arch === 'arm64';

// SPH0645 records at 48kHz natively (S32_LE, mono)
// We record at 48k then whisper handles resampling to 16k
const MIC_RATE = 48000;
const MIC_FORMAT = 'S32_LE';
const MIC_CHANNELS = 1;
const MIC_DEVICE = process.env.MIC_DEVICE || 'plughw:0,0';

// Pirate Audio DAC output
const SPEAKER_DEVICE = process.env.SPEAKER_DEVICE || 'plughw:0,0';

export async function startRecording() {
  const dir = await mkdtemp(join(tmpdir(), 'oc-audio-'));
  const wavPath = join(dir, 'recording.wav');

  let proc;
  if (IS_PI) {
    // ALSA: record from SPH0645 I2S mic
    proc = spawn('arecord', [
      '-D', MIC_DEVICE,
      '-f', MIC_FORMAT,
      '-r', String(MIC_RATE),
      '-c', String(MIC_CHANNELS),
      '-t', 'wav',
      wavPath
    ], { stdio: 'ignore' });
  } else {
    // macOS dev: use sox (brew install sox)
    proc = spawn('sox', [
      '-d',           // default input
      '-r', '16000',  // 16k is fine for dev
      '-c', '1',
      '-b', '16',
      wavPath
    ], { stdio: 'ignore' });
  }

  proc.on('error', (err) => {
    console.error('Record process error:', err.message);
  });

  return { proc, wavPath, dir };
}

export async function stopRecording(handle) {
  return new Promise((resolve, reject) => {
    if (!handle || !handle.proc) return reject(new Error('No recording'));

    const timeout = setTimeout(() => {
      try { handle.proc.kill('SIGKILL'); } catch {}
    }, 1500);

    handle.proc.on('close', () => {
      clearTimeout(timeout);
      resolve(handle.wavPath);
    });
    handle.proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // SIGINT tells arecord to finalize the WAV header
    if (handle.proc.pid) {
      handle.proc.kill('SIGINT');
    }
  });
}

export async function playAudio(wavPath) {
  return new Promise((resolve) => {
    let proc;
    if (IS_PI) {
      // Play through Pirate Audio DAC/amp
      proc = spawn('aplay', ['-D', SPEAKER_DEVICE, wavPath], { stdio: 'ignore' });
    } else {
      // macOS
      proc = spawn('afplay', [wavPath], { stdio: 'ignore' });
    }

    proc.on('close', () => {
      // Clean up temp file
      unlink(wavPath).catch(() => {});
      resolve();
    });
    proc.on('error', (err) => {
      console.error('Playback error:', err.message);
      resolve(); // Don't block pipeline
    });
  });
}
