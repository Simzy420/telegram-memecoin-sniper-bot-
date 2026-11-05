import type { WanFps, WanScheduler } from './constants';

export interface GradioFileData {
  path?: string | null;
  url: string;
  orig_name: string;
  size?: number | null;
  mime_type: string;
  is_stream?: boolean;
  meta: { _type: 'gradio.FileData' };
}

export interface WanGenerateInput {
  inputImage: File;
  lastImage?: File | null;
  prompt: string;
  steps: number;
  negativePrompt: string;
  durationSeconds: number;
  guidanceScale: number;
  guidanceScale2: number;
  seed: number;
  randomizeSeed: boolean;
  quality: number;
  scheduler: WanScheduler;
  flowShift: number;
  frameMultiplier: WanFps;
  videoComponent: boolean;
  safeMode: boolean;
}

export interface GeneratedVideo {
  id: string;
  prompt: string;
  url: string;
  createdAt: number;
  seed?: number;
  provider: 'wan22';
}

export interface WanProgress {
  phase: 'upload' | 'queued' | 'generating' | 'polling';
  detail: string;
  elapsedMs: number;
}

export class WanCorsError extends Error {
  readonly kind = 'cors' as const;
  constructor(message = 'This browser blocked the Space API (CORS). Use the embed below, or open the Space.') {
    super(message);
    this.name = 'WanCorsError';
  }
}

export class WanTimeoutError extends Error {
  readonly kind = 'timeout' as const;
  constructor(elapsedMs: number) {
    super(
      `Timed out after ${Math.round(elapsedMs / 1000)}s. ZeroGPU can take 1–3 minutes — try again, or open the Space.`,
    );
    this.name = 'WanTimeoutError';
  }
}
