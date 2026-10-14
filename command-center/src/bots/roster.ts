import type { Bot } from '@/types/bots';

/** Named roster. Shapes cycle the three geometric avatar styles from the ref sheet. */
export const BOT_ROSTER: Bot[] = [
  { id: 'scout', name: 'Scout', role: 'recon', shape: 'sphere', hue: 'cyan' },
  { id: 'sniper', name: 'Sniper', role: 'precision', shape: 'pyramid', hue: 'purple' },
  { id: 'pulse', name: 'Pulse', role: 'signals', shape: 'cube', hue: 'violet' },
  { id: 'ledger', name: 'Ledger', role: 'records', shape: 'sphere', hue: 'gold' },
  { id: 'shield', name: 'Shield', role: 'guard', shape: 'pyramid', hue: 'green' },
  { id: 'liquid98', name: 'Liquid98Bot', role: 'flow', shape: 'cube', hue: 'cyan' },
  { id: 'chief', name: 'Chief of Staff', role: 'ops', shape: 'sphere', hue: 'magenta' },
];

export function getBot(id: string): Bot | undefined {
  return BOT_ROSTER.find((b) => b.id === id);
}

export const DEFAULT_BOT_ID = 'chief';
