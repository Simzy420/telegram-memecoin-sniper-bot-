import { uid } from '@/lib/ids';
import { requestOpenAiImages, explainOpenAiNetworkError } from '@/adapters/imagegen/openaiApi';
import { readVaultOpenAiKey } from '@/store/vaultStore';
import type { GeneratedImage, ImageGenAdapter, ImageGenInput } from './types';

function toGenerated(prompt: string, urls: { url: string }[], provider: string): GeneratedImage[] {
  return urls.map((item) => ({
    id: uid('img'),
    prompt,
    preview: { kind: 'url', url: item.url },
    createdAt: Date.now(),
    provider,
  }));
}

export const openaiVaultAdapter: ImageGenAdapter = {
  id: 'openai',
  label: 'OpenAI',
  async generate({ prompt, count }: ImageGenInput) {
    const apiKey = readVaultOpenAiKey();
    if (!apiKey) {
      throw new Error('No OpenAI key saved. Paste one in Image gen, or switch to Pollinations (free).');
    }
    try {
      const frames = await requestOpenAiImages({ apiKey, prompt, count });
      return toGenerated(prompt.trim(), frames, 'openai');
    } catch (err) {
      throw explainOpenAiNetworkError(err);
    }
  },
};

export function imageProxyUrl(): string {
  return '/api/generate-image';
}

export function shouldUseImageProxy(): boolean {
  if (import.meta.env.VITE_IMAGE_PROXY === '1') return true;
  if (typeof window !== 'undefined' && /\.vercel\.app$/i.test(window.location.hostname)) return true;
  return false;
}

export const openaiProxyAdapter: ImageGenAdapter = {
  id: 'openai',
  label: 'OpenAI',
  async generate({ prompt, count }: ImageGenInput) {
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error('Enter a prompt first.');
    const res = await fetch(imageProxyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: trimmed, count }),
    });
    const raw = await res.text();
    let parsed: { images?: { url: string }[]; error?: string } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok) {
      throw new Error(parsed.error || `Image proxy HTTP ${res.status}`);
    }
    const images = parsed.images ?? [];
    if (images.length === 0) throw new Error('Image proxy returned no pictures.');
    return toGenerated(trimmed, images, 'openai');
  },
};
