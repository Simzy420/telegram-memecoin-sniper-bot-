import { create } from 'zustand';
import { getChatAdapter, type ChatMessage } from '@/adapters/chat';
import { getBot } from '@/bots/roster';
import { uid } from '@/lib/ids';
import { readJson, writeJson } from '@/store/persist';
import { useActivityStore } from '@/store/activityStore';

const KEY = 'chat';

type Threads = Record<string, ChatMessage[]>;

function load(): Threads {
  return readJson<Threads>(KEY, {});
}

export type ChatBridgeStatus = 'idle' | 'waiting' | 'error';

interface ChatState {
  threads: Threads;
  streaming: Record<string, boolean>;
  errors: Record<string, string>;
  status: ChatBridgeStatus;
  lastError: string | null;
  send: (botId: string, text: string) => Promise<void>;
  clearError: (botId?: string) => void;
}

function save(threads: Threads) {
  writeJson(KEY, threads);
}

export const useChatStore = create<ChatState>((set, get) => ({
  threads: load(),
  streaming: {},
  errors: {},
  status: 'idle',
  lastError: null,
  clearError: (botId) => {
    if (!botId) {
      set({ errors: {}, lastError: null, status: get().status === 'error' ? 'idle' : get().status });
      return;
    }
    const errors = { ...get().errors };
    delete errors[botId];
    set({ errors, lastError: Object.values(errors)[0] ?? null, status: Object.keys(errors).length ? 'error' : 'idle' });
  },
  send: async (botId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (get().streaming[botId]) return;
    const bot = getBot(botId);
    const adapter = getChatAdapter();
    const userMsg: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      botId,
      text: trimmed,
      createdAt: Date.now(),
    };
    const assistantId = uid('msg');
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      botId,
      text: '',
      createdAt: Date.now(),
    };
    const prev = get().threads[botId] ?? [];
    let nextThreads: Threads = {
      ...get().threads,
      [botId]: [...prev, userMsg, assistantMsg],
    };
    const errors = { ...get().errors };
    delete errors[botId];
    save(nextThreads);
    set({
      threads: nextThreads,
      streaming: { ...get().streaming, [botId]: true },
      errors,
      status: 'waiting',
      lastError: null,
    });
    useActivityStore.getState().push({
      botId,
      kind: 'message',
      text: `${bot?.name ?? botId} received a command`,
    });

    try {
      let acc = '';
      for await (const token of adapter.streamReply({
        botId,
        botName: bot?.name ?? botId,
        messages: prev.concat(userMsg),
        userText: trimmed,
      })) {
        acc += token;
        nextThreads = {
          ...get().threads,
          [botId]: (get().threads[botId] ?? []).map((m) =>
            m.id === assistantId ? { ...m, text: acc } : m,
          ),
        };
        set({ threads: nextThreads });
      }
      save(get().threads);
      useActivityStore.getState().push({
        botId,
        kind: 'message',
        text: `${bot?.name ?? botId} replied`,
      });
      set({ status: 'idle' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Chat bridge failed.';
      nextThreads = {
        ...get().threads,
        [botId]: (get().threads[botId] ?? []).filter((m) => m.id !== assistantId),
      };
      save(nextThreads);
      set({
        threads: nextThreads,
        errors: { ...get().errors, [botId]: message },
        lastError: message,
        status: 'error',
      });
    } finally {
      const streaming = { ...get().streaming };
      delete streaming[botId];
      set({ streaming, status: Object.keys(streaming).length ? 'waiting' : get().status === 'error' ? 'error' : 'idle' });
    }
  },
}));
