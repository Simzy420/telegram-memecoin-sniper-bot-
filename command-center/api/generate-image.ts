import { requestOpenAiImages, sanitizeOpenAiError } from '../src/adapters/imagegen/openaiApi.js';

export const config = {
  maxDuration: 60,
  includeFiles: 'src/adapters/imagegen/openaiApi.js',
};

type Req = {
  method?: string;
  body?: unknown;
};

type Res = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => Res;
  json: (body: unknown) => void;
  end: () => void;
};

function readBody(body: unknown): { prompt?: string; count?: number } {
  if (!body) return {};
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as { prompt?: string; count?: number };
    } catch {
      return {};
    }
  }
  if (typeof body === 'object') return body as { prompt?: string; count?: number };
  return {};
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    res.status(500).json({ error: 'Server is missing OPENAI_API_KEY.' });
    return;
  }
  const { prompt, count } = readBody(req.body);
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }
  if (text.length > 4000) {
    res.status(400).json({ error: 'prompt is too long' });
    return;
  }
  const n = typeof count === 'number' && Number.isFinite(count) ? count : 1;
  try {
    const images = await requestOpenAiImages({ apiKey, prompt: text, count: n });
    res.status(200).json({ images });
  } catch (err) {
    const message = sanitizeOpenAiError(err instanceof Error ? err.message : 'OpenAI request failed.');
    res.status(502).json({ error: message });
  }
}
