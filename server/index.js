// OpenClaw Pi Assistant — Server
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRecording, stopRecording, playAudio } from './audio.js';
import { transcribe } from './stt.js';
import { synthesize } from './tts.js';
import { chat } from './openclaw.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(express.static(join(__dirname, '..', 'web')));

const server = createServer(app);
const wss = new WebSocketServer({ server });

// Conversation history (per-connection for now)
const sessions = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  const session = { recording: null, history: [], busy: false };
  sessions.set(ws, session);

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'start_recording':
        await handleStartRecording(ws, session);
        break;
      case 'stop_recording':
        await handleStopRecording(ws, session);
        break;
      case 'stop_speaking':
        // TODO: kill aplay process
        send(ws, { type: 'state', state: 'idle' });
        break;
      case 'confirm_response':
        // Handle confirmation from UI
        if (session.pendingConfirm) {
          session.pendingConfirm(msg.confirmed);
          session.pendingConfirm = null;
        }
        break;
      default:
        console.log('Unknown client message:', msg.type);
    }
  });

  ws.on('close', () => {
    sessions.delete(ws);
    console.log('Client disconnected');
  });
});

function send(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

async function handleStartRecording(ws, session) {
  if (session.busy) return;
  try {
    session.recording = await startRecording();
    send(ws, { type: 'state', state: 'listening' });
    console.log('Recording started');
  } catch (err) {
    console.error('Record start error:', err);
    send(ws, { type: 'error', text: 'Mic error' });
  }
}

async function handleStopRecording(ws, session) {
  if (!session.recording) return;
  session.busy = true;

  try {
    // Stop recording → get WAV path
    send(ws, { type: 'state', state: 'thinking' });
    const wavPath = await stopRecording(session.recording);
    session.recording = null;
    console.log('Recording saved:', wavPath);

    // Transcribe
    const transcript = await transcribe(wavPath);
    if (!transcript || !transcript.trim()) {
      send(ws, { type: 'error', text: 'Could not hear you' });
      session.busy = false;
      return;
    }
    console.log('Transcript:', transcript);
    send(ws, { type: 'transcript', text: transcript });

    // Chat with OpenClaw gateway
    session.history.push({ role: 'user', content: transcript });

    send(ws, { type: 'response_start' });
    let fullResponse = '';

    await chat(transcript, session.history, (chunk) => {
      fullResponse += chunk;
      send(ws, { type: 'response_chunk', text: chunk });
    });

    send(ws, { type: 'response_done', text: fullResponse });
    session.history.push({ role: 'assistant', content: fullResponse });

    // Trim history
    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    // TTS → play
    console.log('Synthesizing:', fullResponse.slice(0, 60) + '...');
    const audioPath = await synthesize(fullResponse);
    if (audioPath) {
      send(ws, { type: 'state', state: 'speaking' });
      await playAudio(audioPath);
    }
    send(ws, { type: 'audio_done' });

  } catch (err) {
    console.error('Pipeline error:', err);
    send(ws, { type: 'error', text: err.message || 'Something went wrong' });
  } finally {
    session.busy = false;
  }
}

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', connections: wss.clients.size });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🐾 OpenClaw Pi Assistant on http://0.0.0.0:${PORT}`);
});
