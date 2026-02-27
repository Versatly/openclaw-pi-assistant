import { spawn, execSync } from 'child_process';
import { join } from 'path';
import { mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { tmpdir } from 'os';

const RECORDINGS_DIR = process.env.RECORDINGS_DIR || join(tmpdir(), 'openclaw-recordings');
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const FORMAT = 'S16_LE';

if (!existsSync(RECORDINGS_DIR)) {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
}

function isPi() {
  if (process.env.FORCE_PI === 'true') return true;
  if (process.env.FORCE_DEV === 'true') return false;
  
  try {
    const cpuInfo = execSync('cat /proc/cpuinfo 2>/dev/null || echo ""', { encoding: 'utf8' });
    return cpuInfo.includes('Raspberry Pi') || cpuInfo.includes('BCM');
  } catch {
    return false;
  }
}

function getRecordCommand() {
  const isRaspberryPi = process.platform === 'linux' && 
    (process.arch === 'arm64' || process.arch === 'arm');
  
  if (isRaspberryPi || process.env.FORCE_PI === 'true') {
    return {
      cmd: 'arecord',
      args: [
        '-D', 'default',
        '-f', FORMAT,
        '-r', String(SAMPLE_RATE),
        '-c', String(CHANNELS),
        '-t', 'wav',
      ]
    };
  }
  
  if (process.platform === 'darwin') {
    return {
      cmd: 'sox',
      args: [
        '-d',
        '-r', String(SAMPLE_RATE),
        '-c', String(CHANNELS),
        '-b', '16',
        '-e', 'signed-integer',
      ]
    };
  }
  
  return {
    cmd: 'arecord',
    args: [
      '-f', FORMAT,
      '-r', String(SAMPLE_RATE),
      '-c', String(CHANNELS),
      '-t', 'wav',
    ]
  };
}

function getPlayCommand() {
  const isRaspberryPi = process.platform === 'linux' && 
    (process.arch === 'arm64' || process.arch === 'arm');
  
  if (isRaspberryPi || process.env.FORCE_PI === 'true') {
    return { cmd: 'aplay', args: ['-D', 'default'] };
  }
  
  if (process.platform === 'darwin') {
    return { cmd: 'afplay', args: [] };
  }
  
  return { cmd: 'aplay', args: [] };
}

export function startRecording() {
  const timestamp = Date.now();
  const wavPath = join(RECORDINGS_DIR, `recording_${timestamp}.wav`);
  const { cmd, args } = getRecordCommand();
  
  const fullArgs = [...args, wavPath];
  console.log(`[Audio] Starting: ${cmd} ${fullArgs.join(' ')}`);
  
  const proc = spawn(cmd, fullArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  proc.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('Recording WAVE')) {
      console.log(`[Audio] ${msg}`);
    }
  });
  
  proc.on('error', (err) => {
    console.error(`[Audio] Record process error: ${err.message}`);
  });
  
  return {
    process: proc,
    wavPath,
    startTime: timestamp
  };
}

export function stopRecording(recording) {
  return new Promise((resolve, reject) => {
    if (!recording || !recording.process) {
      reject(new Error('No recording process'));
      return;
    }
    
    const { process: proc, wavPath, startTime } = recording;
    const duration = Date.now() - startTime;
    
    if (duration < 500) {
      console.log('[Audio] Recording too short, waiting...');
      setTimeout(() => {
        doStop();
      }, 500 - duration);
    } else {
      doStop();
    }
    
    function doStop() {
      let resolved = false;
      
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill('SIGKILL');
          resolve(wavPath);
        }
      }, 2000);
      
      proc.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          console.log(`[Audio] Recording saved: ${wavPath} (${duration}ms)`);
          resolve(wavPath);
        }
      });
      
      proc.kill('SIGINT');
    }
  });
}

export function playAudio(audioPath) {
  return new Promise((resolve, reject) => {
    if (!existsSync(audioPath)) {
      reject(new Error(`Audio file not found: ${audioPath}`));
      return;
    }
    
    const { cmd, args } = getPlayCommand();
    const fullArgs = [...args, audioPath];
    
    console.log(`[Audio] Playing: ${cmd} ${fullArgs.join(' ')}`);
    
    const proc = spawn(cmd, fullArgs, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    proc.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('Playing WAVE')) {
        console.log(`[Audio] ${msg}`);
      }
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        cleanupFile(audioPath);
        resolve();
      } else {
        reject(new Error(`Playback failed with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(new Error(`Playback error: ${err.message}`));
    });
  });
}

function cleanupFile(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
      console.log(`[Audio] Cleaned up: ${filePath}`);
    }
  } catch (err) {
    console.error(`[Audio] Cleanup failed: ${err.message}`);
  }
}

export function cleanupOldRecordings(maxAgeMs = 3600000) {
  try {
    const files = readdirSync(RECORDINGS_DIR);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = join(RECORDINGS_DIR, file);
      const stats = statSync(filePath);
      if (now - stats.mtimeMs > maxAgeMs) {
        unlinkSync(filePath);
        console.log(`[Audio] Cleaned old file: ${file}`);
      }
    }
  } catch (err) {
    console.error(`[Audio] Cleanup error: ${err.message}`);
  }
}
