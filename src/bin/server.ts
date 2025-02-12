#!/usr/bin/env node

import express from 'express';
import assert from 'assert';
import { GradioChatBot, generateHash } from '../';

export type Role = 'user' | 'assistant' | 'system'
export type Action = 'next' | 'variant';

export interface APIMessage {
  role: Role
  content: string
}

export interface APIRequest {
  model: string
  action: Action
  messages: APIMessage[]
}

export interface APIResponse {
  whisper?: string
  choices: {
    delta?: APIMessage
    message: APIMessage
  }[]
}

const PORT = isNaN(parseInt(process.env.PORT, 10)) ? 8000 : parseInt(process.env.PORT, 10);
const app = express();
app.use(express.json());

function parseOpenAIMessage(request: APIRequest) {
  const history: [string, string][] = [];
  request.messages?.forEach((message) => {
    if (message.role === 'assistant' || message.role === 'user') {
      history.push([message.content, '']);
    } else if (history.length) {
      history.at(-1)[1] = message.content;
    }
  })
  return {
    history,
    prompt: request.messages?.reverse().find((message) => message.role === 'user')?.content,
    model: request.model,
  };
}

function responseOpenAIMessage(content: string, input?: string): APIResponse {
  const message: APIMessage = {
    role: 'assistant',
    content,
  };
  return {
    whisper: input,
    choices: [{
      delta: message,
      message,
    }],
  };
}

app.post(['/', '/api/conversation'], async (req, res) => {
  const { prompt, model, history } = parseOpenAIMessage(req.body);
  const chatbot = new GradioChatBot({
    url: model,
    historySize: 20,
  });
  chatbot.history = history;
  const isStream = req.headers.accept?.includes('text/event-stream');
  if (isStream) {
    res.set('Content-Type', 'text/event-stream; charset=utf-8');
  }
  assert(prompt, 'messages can\'t be empty!');
  const content = await chatbot.chat(prompt, {
    onMessage(msg) {
      if (isStream) {
        res.write(`data: ${JSON.stringify(responseOpenAIMessage(msg))}\n`);
      }
    }
  });
  const response = responseOpenAIMessage(content);
  if (isStream) {
    res.write(`data: [DONE]`);
  } else {
    res.json(response);
  }
});

app.get(['/', '/api/conversation'], async (req, res) => {
  const { text, model } = req.query || {};
  if (!text) {
    return res.status(500).write('text can\'t be empty!');
  }
  res.set('Cache-Control', 'no-cache');
  res.set('Content-Type', 'text/event-stream; charset=utf-8');
  let lastLength = 0;
  const chatbot = new GradioChatBot({
    url: String(model || '0'),
    historySize: 20,
  });
  const content = await chatbot.chat(String(text), {
    onMessage: (msg) => {
      res.write(msg.slice(lastLength));
      lastLength = msg.length;
    }
  });
  res.end(content.slice(lastLength));
});

app.listen(Math.max(Math.min(65535, PORT), 80), '0.0.0.0');
console.log(`\nServer start successful, serve link: http://localhost:${PORT}/api/conversation?text=hello\n`);

/**
curl http://127.0.0.1:8000/api/conversation \
  -H "accept: text/event-stream"
  -H "Content-Type: application/json" \
  -d '{
     "model": "https://huggingface.co/spaces/mikeee/chatglm2-6b-4bit",
     "messages": [{"role": "user", "content": "hello"}],
   }'
 */