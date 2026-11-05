import type { ChatAdapter, ChatStreamInput } from './types';

const LINES: Record<string, string[]> = {
  scout: [
    'Recon sweep complete. Layout grid is live. Watchlist prices come from CoinGecko, not from me.',
    'I can watch a widget region, but I will not invent prices or mail.',
    'Point me at a board and I will keep a running activity log.',
  ],
  sniper: [
    'Locked on that prompt. One thread, one bot, no spray.',
    'Say the target widget and I will keep replies scoped to it.',
    'Precision mode: I only answer what you asked.',
  ],
  pulse: [
    'Signal received. Streaming a mock token feed so the UI can prove itself.',
    'Pulse check: this chat stream is mock. Watchlist quotes are live CoinGecko, not this feed.',
    'When you plug in a real provider, this stream interface stays the same.',
  ],
  ledger: [
    'Noted. Files, todos, and layout JSON are the only records I will keep locally.',
    'I will not fabricate P&L. Connect a data source when you have one.',
    'Export the layout anytime from System — that is the source of truth.',
  ],
  shield: [
    'Guard rail: Observe Only never blocks Use mode. You can still command us.',
    'No wallet signing, no live orders. This is a spectator-safe shell.',
    'I am watching the perimeter of the current board.',
  ],
  liquid98: [
    'Flowing through the mock pipe. Tokens in, tokens out.',
    'Liquid98Bot standing by for image prompts or board edits.',
    'If you long-press in Edit mode, the grid will yield. Use mode stays scrollable.',
  ],
  chief: [
    'Chief of Staff here. Roster is online: Scout, Sniper, Pulse, Ledger, Shield, Liquid98Bot, and me.',
    'Default is Use mode. Observe Only is an optional overlay for avatar motion.',
    'Tear the starter board down whenever you like — nothing is hard-coded in the grid.',
  ],
};

function pickLine(botId: string, userText: string): string {
  const pool = LINES[botId] ?? LINES.scout;
  const seed = Array.from(userText).reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = pool[seed % pool.length];
  const clipped = userText.trim().slice(0, 80);
  if (!clipped) return base;
  return `${base} You said: “${clipped}”.`;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export const mockChatAdapter: ChatAdapter = {
  id: 'mock',
  label: 'Mock chat (swap-in)',
  async *streamReply(input: ChatStreamInput) {
    const line = pickLine(input.botId, input.userText);
    const tokens = line.split(/(\s+)/);
    for (const token of tokens) {
      await sleep(28 + Math.floor(Math.random() * 42));
      yield token;
    }
  },
};
