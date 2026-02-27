import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { startRecording, stopRecording, playAudio } from './audio.js';
import { transcribe } from './stt.js';
import { synthesize } from './tts.js';
import { chat } from './openclaw.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3001;

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(join(__dirname, '../web')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

const conversationHistory = new Map();
const MAX_HISTORY = 10;

function getHistory(clientId) {
  if (!conversationHistory.has(clientId)) {
    conversationHistory.set(clientId, []);
  }
  return conversationHistory.get(clientId);
}

function addToHistory(clientId, role, content) {
  const history = getHistory(clientId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

function sendMessage(ws, type, data = {}) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type, ...data }));
  }
}

wss.on('connection', (ws) => {
  const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  console.log(`[WS] Client connected: ${clientId}`);

  let isRecording = false;
  let recordingProcess = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (err) {
      console.error('[WS] Invalid JSON:', err.message);
      return;
    }

    console.log(`[WS] Received: ${data.type}`);

    switch (data.type) {
      case 'start_recording':
        if (isRecording) {
          sendMessage(ws, 'error', { message: 'Already recording' });
          return;
        }
        try {
          recordingProcess = startRecording();
          isRecording = true;
          sendMessage(ws, 'recording_started');
          console.log('[Audio] Recording started');
        } catch (err) {
          console.error('[Audio] Failed to start recording:', err.message);
          sendMessage(ws, 'error', { message: 'Failed to start recording' });
        }
        break;

      case 'stop_recording':
        if (!isRecording) {
          sendMessage(ws, 'error', { message: 'Not recording' });
          return;
        }
        try {
          sendMessage(ws, 'recording_stopped');
          sendMessage(ws, 'state', { state: 'thinking' });
          console.log('[Audio] Recording stopped, processing...');

          const wavPath = await stopRecording(recordingProcess);
          isRecording = false;
          recordingProcess = null;

          sendMessage(ws, 'state', { state: 'transcribing' });
          const transcript = await transcribe(wavPath);
          console.log(`[STT] Transcript: "${transcript}"`);

          if (!transcript || transcript.trim().length === 0) {
            sendMessage(ws, 'error', { message: 'Could not understand audio' });
            sendMessage(ws, 'state', { state: 'idle' });
            return;
          }

          sendMessage(ws, 'transcript', { text: transcript });
          addToHistory(clientId, 'user', transcript);

          sendMessage(ws, 'state', { state: 'thinking' });
          const history = getHistory(clientId);

          let fullResponse = '';
          await chat(transcript, history, (chunk) => {
            fullResponse += chunk;
            sendMessage(ws, 'response_chunk', { text: chunk });
          });

          addToHistory(clientId, 'assistant', fullResponse);
          sendMessage(ws, 'response_complete', { text: fullResponse });
          console.log(`[OpenClaw] Response: "${fullResponse.slice(0, 100)}..."`);

          sendMessage(ws, 'state', { state: 'speaking' });
          const audioPath = await synthesize(fullResponse);
          console.log(`[TTS] Audio generated: ${audioPath}`);

          await playAudio(audioPath);
          console.log('[Audio] Playback complete');

          sendMessage(ws, 'state', { state: 'idle' });
        } catch (err) {
          console.error('[Pipeline] Error:', err.message);
          sendMessage(ws, 'error', { message: err.message || 'Processing failed' });
          sendMessage(ws, 'state', { state: 'idle' });
          isRecording = false;
          recordingProcess = null;
        }
        break;

      case 'clear_history':
        conversationHistory.delete(clientId);
        sendMessage(ws, 'history_cleared');
        console.log(`[History] Cleared for ${clientId}`);
        break;

      default:
        console.log(`[WS] Unknown message type: ${data.type}`);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Client disconnected: ${clientId}`);
    if (isRecording && recordingProcess) {
      stopRecording(recordingProcess).catch(() => {});
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for ${clientId}:`, err.message);
  });

  sendMessage(ws, 'connected', { clientId });
});

server.listen(PORT, () => {
  console.log(`[Server] OpenClaw Pi Assistant running on port ${PORT}`);
  console.log(`[Server] Web UI: http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  wss.clients.forEach((client) => {
    client.close();
  });
  server.close(() => {
    console.log('[Server] Goodbye!');
    process.exit(0);
  });
});
