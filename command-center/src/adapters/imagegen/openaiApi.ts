export type OpenAiImage = {
  url: string;
};

type OpenAiImagePayload = {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; code?: string };
};

const OPENAI_IMAGES = 'https://api.openai.com/v1/images/generations';
const PRIMARY_MODEL = 'gpt-image-1';
const FALLBACK_MODEL = 'dall-e-3';

export function sanitizeOpenAiError(text: string): string {
  return text.replace(/sk-[a-zA-Z0-9_\-]+/g, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 280);
}

function toPreviewUrl(item: { b64_json?: string; url?: string }): string | null {
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item.url) return item.url;
  return null;
}

async function postImages(apiKey: string, body: Record<string, unknown>): Promise<OpenAiImage[]> {
  const res = await fetch(OPENAI_IMAGES, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed: OpenAiImagePayload = {};
  try {
    parsed = raw ? (JSON.parse(raw) as OpenAiImagePayload) : {};
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    const msg = parsed.error?.message || raw || `OpenAI HTTP ${res.status}`;
    const err = new Error(sanitizeOpenAiError(msg));
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const urls = (parsed.data ?? [])
    .map(toPreviewUrl)
    .filter((u): u is string => Boolean(u))
    .map((url) => ({ url }));
  if (urls.length === 0) throw new Error('OpenAI returned no images.');
  return urls;
}

function modelLooksUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  return msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'));
}

/** Shared OpenAI Images call. Never logs the key. */
export async function requestOpenAiImages(input: {
  apiKey: string;
  prompt: string;
  count: number;
}): Promise<OpenAiImage[]> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Enter a prompt first.');
  const n = Math.min(4, Math.max(1, input.count));
  try {
    return await postImages(input.apiKey, {
      model: PRIMARY_MODEL,
      prompt,
      n,
      size: '1024x1024',
    });
  } catch (err) {
    if (!modelLooksUnavailable(err)) throw err;
  }
  const frames: OpenAiImage[] = [];
  for (let i = 0; i < n; i++) {
    const batch = await postImages(input.apiKey, {
      model: FALLBACK_MODEL,
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });
    frames.push(...batch);
  }
  return frames;
}

export function explainOpenAiNetworkError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      'Could not reach OpenAI from this page (often CORS on GitHub Pages). Switch to Pollinations (free), or use a host with the image proxy.',
    );
  }
  return err instanceof Error ? err : new Error('OpenAI request failed.');
}
