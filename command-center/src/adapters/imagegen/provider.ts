export type StillImageProvider = 'pollinations' | 'openai';

export type StillAdapterKind = 'pollinations' | 'openai-proxy' | 'openai-vault';

/** Unset or unknown values stay on the free path so Generate works without a key. */
export function normalizeStillImageProvider(raw: unknown): StillImageProvider {
  return raw === 'openai' ? 'openai' : 'pollinations';
}

/** Pollinations never consults a key or the Vercel proxy. OpenAI uses the proxy when this host has one. */
export function stillAdapterKind(provider: StillImageProvider, useProxy: boolean): StillAdapterKind {
  if (provider !== 'openai') return 'pollinations';
  return useProxy ? 'openai-proxy' : 'openai-vault';
}
