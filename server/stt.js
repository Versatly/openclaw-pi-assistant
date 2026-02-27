// STT — whisper.cpp or Python whisper integration
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';

const execFileAsync = promisify(execFile);

// Try whisper-cli (whisper.cpp) first, then whisper (Python), then fallback
const WHISPER_PATH = process.env.WHISPER_PATH || null;
const WHISPER_MODEL = process.env.WHISPER_MODEL || null;

async function which(cmd) {
  try {
    const { stdout } = await execFileAsync('which', [cmd]);
    return stdout.trim();
  } catch { return null; }
}

let resolvedBin = null;
let binType = null; // 'cpp' | 'python'

async function resolveBin() {
  if (resolvedBin) return;

  if (WHISPER_PATH) {
    resolvedBin = WHISPER_PATH;
    binType = WHISPER_PATH.includes('whisper-cpp') || WHISPER_PATH.includes('main') ? 'cpp' : 'python';
    return;
  }

  // Try whisper-cpp first (faster on Pi)
  const cppBin = await which('whisper-cli') || await which('whisper-cpp');
  if (cppBin) {
    resolvedBin = cppBin;
    binType = 'cpp';
    return;
  }

  // Fall back to Python whisper
  const pyBin = await which('whisper');
  if (pyBin) {
    resolvedBin = pyBin;
    binType = 'python';
    return;
  }

  throw new Error('No whisper binary found. Install whisper-cpp or openai-whisper.');
}

export async function transcribe(wavPath) {
  await resolveBin();

  if (binType === 'cpp') {
    return transcribeCpp(wavPath);
  } else {
    return transcribePython(wavPath);
  }
}

async function transcribeCpp(wavPath) {
  const args = [
    '-f', wavPath,
    '--no-timestamps',
    '-l', 'en',
    '--output-txt',
  ];
  if (WHISPER_MODEL) {
    args.push('-m', WHISPER_MODEL);
  }

  try {
    const { stdout, stderr } = await execFileAsync(resolvedBin, args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    // whisper.cpp outputs to stdout or creates a .txt file
    const text = stdout.trim();
    if (text) return text;

    // Try reading the output txt file
    try {
      const txtPath = wavPath + '.txt';
      const content = await readFile(txtPath, 'utf-8');
      unlink(txtPath).catch(() => {});
      return content.trim();
    } catch {}

    return '';
  } catch (err) {
    console.error('whisper-cpp error:', err.message);
    throw new Error('Transcription failed');
  }
}

async function transcribePython(wavPath) {
  const args = [
    wavPath,
    '--model', WHISPER_MODEL || 'base',
    '--language', 'en',
    '--output_format', 'txt',
    '--output_dir', '/tmp',
  ];

  try {
    await execFileAsync(resolvedBin, args, {
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    });

    // Python whisper outputs to <basename>.txt
    const basename = wavPath.split('/').pop().replace('.wav', '');
    const txtPath = `/tmp/${basename}.txt`;
    const content = await readFile(txtPath, 'utf-8');
    unlink(txtPath).catch(() => {});
    return content.trim();
  } catch (err) {
    console.error('whisper (python) error:', err.message);
    throw new Error('Transcription failed');
  }
}
