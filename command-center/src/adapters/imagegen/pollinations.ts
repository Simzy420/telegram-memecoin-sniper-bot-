import { uid } from '@/lib/ids';
import type { GeneratedImage, ImageGenAdapter } from './types';

const ENDPOINT = 'https://image.pollinations.ai/prompt';

function seedFor(prompt: string, index: number): number {
  const now = Date.now() % 1_000_000_007;
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs((now + (h >>> 0) + index * 10007) % 2147483647);
}

export function pollinationsImageUrl(prompt: string, seed: number): string {
  const encoded = encodeURIComponent(prompt);
  const params = new URLSearchParams({
    width: '768',
    height: '768',
    seed: String(seed),
    nologo: 'true',
    model: 'zimage',
  });
  return `${ENDPOINT}/${encoded}?${params.toString()}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function probeImage(url: string, timeoutMs = 45000): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.src = '';
      reject(new Error('Timed out waiting for Pollinations.'));
    }, timeoutMs);
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Pollinations did not return an image. Try again in a moment.'));
    };
    img.src = url;
  });
}

/** No-key image URL API. The browser loads results as <img src>. */
export const pollinationsImageAdapter: ImageGenAdapter = {
  id: 'pollinations',
  label: 'Pollinations',
  async generate({ prompt, count }) {
    const trimmed = prompt.trim();
    if (!trimmed) throw new Error('Enter a prompt first.');
    const n = Math.min(6, Math.max(1, count));
    const jobs = Array.from({ length: n }, (_, i) => {
      const seed = seedFor(trimmed, i);
      const url = pollinationsImageUrl(trimmed, seed);
      const image: GeneratedImage = {
        id: uid('img'),
        prompt: trimmed,
        preview: { kind: 'url', url },
        createdAt: Date.now(),
        provider: 'pollinations',
      };
      return (async () => {
        await sleep(i * 350);
        await probeImage(url);
        return image;
      })();
    });
    const settled = await Promise.allSettled(jobs);
    const ok = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (ok.length === 0) {
      const first = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      const reason = first?.reason;
      const message =
        reason instanceof Error ? reason.message : 'Image generation failed. Try a shorter prompt, then Gen again.';
      throw new Error(message);
    }
    return ok;
  },
};
