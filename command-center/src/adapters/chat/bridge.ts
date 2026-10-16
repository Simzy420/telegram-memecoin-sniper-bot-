import { readJson, writeJsonForced } from '@/store/persist';
import { readVaultChatApiBase } from '@/store/vaultStore';
import type { ChatAdapter, ChatStreamInput } from './types';

const SESSION_KEY = 'chatSession';
const POLL_MS = 1500;
const TIMEOUT_MS = 10 * 60 * 1000;

interface BridgePollMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  botId: string;
  text: string;
  clientMsgId?: string;
  createdAt: number;
  status?: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Production chat bridge — Hugging Face Space, already live. */
export const DEFAULT_CHAT_API_BASE = 'https://simzy-command-center-chat.hf.space';

/** Hugging Face Space origin, no trailing slash. Vault → env → live Space. */
export function resolveChatApiBase(): string {
  const vault = readVaultChatApiBase().replace(/\/$/, '');
  if (vault) return vault;
  const env = (import.meta.env.VITE_CHAT_API_BASE ?? '').trim().replace(/\/$/, '');
  if (env) return env;
  return DEFAULT_CHAT_API_BASE;
}

export function isChatBridgeConfigured(): boolean {
  return Boolean(resolveChatApiBase());
}

export function chatApiUrl(path: string): string {
  const base = resolveChatApiBase();
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}

export function getChatSessionId(): string {
  const existing = readJson<string>(SESSION_KEY, '');
  if (typeof existing === 'string' && existing.length >= 8) return existing;
  const id = crypto.randomUUID();
  writeJsonForced(SESSION_KEY, id);
  return id;
}

function missingBridgeError(): Error {
  return new Error(
    `Chat bridge URL is missing. Default is ${DEFAULT_CHAT_API_BASE}. Set it in System → Chat bridge if you overrode it. Chief of Staff cannot answer until that URL is set — no mock replies.`,
  );
}

async function readError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');
  try {
    const parsed = raw ? (JSON.parse(raw) as { error?: string; detail?: unknown }) : {};
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail;
  } catch {
    /* not json */
  }
  return raw.slice(0, 240) || `Chat API HTTP ${res.status}`;
}

async function* chunkText(text: string): AsyncGenerator<string> {
  const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
  if (parts.length <= 1) {
    yield text;
    return;
  }
  for (const part of parts) {
    await sleep(18);
    yield part;
  }
}

export const bridgeChatAdapter: ChatAdapter = {
  id: 'bridge',
  label: 'Chief of Staff bridge',
  async *streamReply(input: ChatStreamInput) {
    if (!isChatBridgeConfigured()) throw missingBridgeError();
    const sessionId = getChatSessionId();
    const clientMsgId = crypto.randomUUID();
    const history = input.messages.slice(-20).map((m) => ({
      role: m.role,
      botId: m.botId,
      text: m.text,
    }));

    let post: Response;
    try {
      post = await fetch(chatApiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          clientMsgId,
          botId: input.botId,
          botName: input.botName,
          text: input.userText,
          history,
        }),
      });
    } catch {
      throw new Error(
        `Could not reach the Hugging Face Space. Check Chat API base in System (${DEFAULT_CHAT_API_BASE}).`,
      );
    }
    if (!post.ok) throw new Error(await readError(post));

    const started = Date.now();
    let emitted = '';
    let sawPartial = false;

    while (Date.now() - started < TIMEOUT_MS) {
      await sleep(POLL_MS);
      let poll: Response;
      try {
        poll = await fetch(`${chatApiUrl('/api/chat')}?sessionId=${encodeURIComponent(sessionId)}`);
      } catch {
        continue;
      }
      if (!poll.ok) {
        if (poll.status >= 500) continue;
        throw new Error(await readError(poll));
      }
      const data = (await poll.json()) as { messages?: BridgePollMessage[]; error?: string };
      const messages = data.messages ?? [];
      const assistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.clientMsgId === clientMsgId);
      if (!assistant) continue;
      const next = assistant.text ?? '';
      if (next.length > emitted.length) {
        const delta = next.slice(emitted.length);
        emitted = next;
        if (assistant.status === 'partial') {
          sawPartial = true;
          yield delta;
        }
      }
      if (assistant.status === 'final' || assistant.status === 'error') {
        if (sawPartial) {
          if (next.length > emitted.length) yield next.slice(emitted.length);
          else if (!emitted && next) yield next;
          return;
        }
        if (!next.trim()) {
          throw new Error('Chief of Staff returned an empty reply.');
        }
        yield* chunkText(next);
        return;
      }
    }
    throw new Error('Timed out waiting for Chief of Staff (10 minutes). Keep the chat open and try again.');
  },
};
