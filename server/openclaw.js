const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'openclaw';
const REQUEST_TIMEOUT = parseInt(process.env.OLLAMA_TIMEOUT || '120000', 10);

const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || `You are OpenClaw, a helpful voice assistant running on a Raspberry Pi. Keep responses concise and conversational since they will be spoken aloud. Avoid using markdown formatting, code blocks, or special characters. Speak naturally as if having a conversation.`;

const MAX_HISTORY = 10;

export async function chat(message, history = [], onChunk = null) {
  const messages = buildMessages(message, history);
  
  console.log(`[OpenClaw] Sending to ${OLLAMA_HOST}/api/chat`);
  console.log(`[OpenClaw] Model: ${OLLAMA_MODEL}`);
  console.log(`[OpenClaw] History: ${history.length} messages`);

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: !!onChunk,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          num_predict: 500,
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    if (onChunk && response.body) {
      return await handleStreamingResponse(response, onChunk);
    } else {
      const data = await response.json();
      return data.message?.content || '';
    }
  } catch (err) {
    console.error(`[OpenClaw] Error: ${err.message}`);
    
    if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
      throw new Error('Request timed out. The AI is taking too long to respond.');
    }
    
    if (err.message.includes('ECONNREFUSED') || err.message.includes('fetch failed')) {
      throw new Error('Cannot connect to OpenClaw. Make sure Ollama is running.');
    }
    
    throw err;
  }
}

function buildMessages(message, history) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  const recentHistory = history.slice(-MAX_HISTORY);
  for (const msg of recentHistory) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }
  }

  messages.push({
    role: 'user',
    content: message,
  });

  return messages;
}

async function handleStreamingResponse(response, onChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);
          
          if (data.message?.content) {
            const chunk = data.message.content;
            fullResponse += chunk;
            
            if (onChunk) {
              onChunk(chunk);
            }
          }

          if (data.done) {
            console.log(`[OpenClaw] Stream complete, ${fullResponse.length} chars`);
          }
        } catch (parseErr) {
          console.warn(`[OpenClaw] Failed to parse chunk: ${line}`);
        }
      }
    }

    if (buffer.trim()) {
      try {
        const data = JSON.parse(buffer);
        if (data.message?.content) {
          fullResponse += data.message.content;
          if (onChunk) {
            onChunk(data.message.content);
          }
        }
      } catch {
      }
    }

    return fullResponse;
  } finally {
    reader.releaseLock();
  }
}

export async function checkOllamaConnection() {
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) {
      return { connected: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    const models = data.models || [];
    const hasModel = models.some(m => m.name === OLLAMA_MODEL || m.name.startsWith(`${OLLAMA_MODEL}:`));
    
    return {
      connected: true,
      models: models.map(m => m.name),
      hasModel,
      requiredModel: OLLAMA_MODEL,
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
    };
  }
}

export async function pullModel(modelName = OLLAMA_MODEL) {
  console.log(`[OpenClaw] Pulling model: ${modelName}`);
  
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: modelName }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to pull model: ${response.status}`);
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          if (data.status) {
            console.log(`[OpenClaw] Pull: ${data.status}`);
          }
        } catch {
        }
      }
    }
    
    console.log(`[OpenClaw] Model ${modelName} ready`);
    return true;
  } catch (err) {
    console.error(`[OpenClaw] Pull failed: ${err.message}`);
    return false;
  }
}
