import { uid } from '@/lib/ids';
import type { GeneratedImage, ImageGenAdapter } from './types';

const PALETTES = [
  ['#22e9ff', '#312e81', '#e879f9'],
  ['#4ade80', '#0f172a', '#22e9ff'],
  ['#f5c542', '#7c3aed', '#0ea5e9'],
  ['#f472b6', '#1e1b4b', '#67e8f9'],
  ['#a78bfa', '#082f49', '#22c55e'],
  ['#38bdf8', '#581c87', '#facc15'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export const mockImageAdapter: ImageGenAdapter = {
  id: 'mock',
  label: 'Mock image gen (swap-in)',
  async generate({ prompt, count }) {
    await sleep(700 + Math.floor(Math.random() * 500));
    const n = Math.min(6, Math.max(1, count));
    const images: GeneratedImage[] = [];
    const h = hash(prompt || 'swarm');
    for (let i = 0; i < n; i++) {
      const pal = PALETTES[(h + i * 3) % PALETTES.length];
      images.push({
        id: uid('img'),
        prompt,
        preview: {
          kind: 'gradient',
          colors: pal,
          seed: `${h.toString(16)}-${i}`,
        },
        createdAt: Date.now(),
        provider: 'mock',
      });
    }
    return images;
  },
};
