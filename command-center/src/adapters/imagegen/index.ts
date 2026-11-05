import type { ImageGenAdapter } from './types';
import { openaiProxyAdapter, openaiVaultAdapter, shouldUseImageProxy } from './openai';
import { pollinationsImageAdapter } from './pollinations';
import { stillAdapterKind, type StillImageProvider } from './provider';

export function getImageGenAdapter(provider: StillImageProvider): ImageGenAdapter {
  const kind = stillAdapterKind(provider, shouldUseImageProxy());
  if (kind === 'openai-proxy') return openaiProxyAdapter;
  if (kind === 'openai-vault') return openaiVaultAdapter;
  return pollinationsImageAdapter;
}

export function imageGenProviderLabel(provider: StillImageProvider): string {
  return getImageGenAdapter(provider).label;
}

export { mockImageAdapter } from './mock';
export { pollinationsImageAdapter } from './pollinations';
export { openaiVaultAdapter, openaiProxyAdapter, shouldUseImageProxy } from './openai';
export { normalizeStillImageProvider, stillAdapterKind } from './provider';
export type { StillAdapterKind, StillImageProvider } from './provider';

export type { ImageGenAdapter, GeneratedImage, ImageGenInput, ImagePreview } from './types';
