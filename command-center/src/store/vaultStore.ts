import { create } from 'zustand';
import { readJson, removeJson, writeJsonForced } from '@/store/persist';

const KEY = 'vault.openai';
const CHAT_BASE_KEY = 'vault.chatApiBase';

interface StoredVault {
  key: string;
}

function loadKey(): string {
  const stored = readJson<StoredVault | null>(KEY, null);
  if (!stored || typeof stored.key !== 'string') return '';
  return stored.key.trim();
}

function loadChatApiBase(): string {
  const stored = readJson<string>(CHAT_BASE_KEY, '');
  return typeof stored === 'string' ? stored.trim() : '';
}

function hintFor(key: string): string {
  const t = key.trim();
  if (t.length < 8) return t ? 'saved' : '';
  return `…${t.slice(-4)}`;
}

interface VaultState {
  hasKey: boolean;
  hint: string;
  chatApiBase: string;
  saveKey: (raw: string) => boolean;
  clearKey: () => void;
  /** In-memory only. Never log this value. */
  peekKey: () => string;
  saveChatApiBase: (raw: string) => boolean;
  clearChatApiBase: () => void;
}

export const useVaultStore = create<VaultState>((set) => {
  const initial = loadKey();
  let secret = initial;
  return {
    hasKey: initial.length > 0,
    hint: hintFor(initial),
    chatApiBase: loadChatApiBase(),
    saveKey: (raw) => {
      const next = raw.trim();
      if (!next) return false;
      secret = next;
      writeJsonForced(KEY, { key: next } satisfies StoredVault);
      set({ hasKey: true, hint: hintFor(next) });
      return true;
    },
    clearKey: () => {
      secret = '';
      removeJson(KEY);
      set({ hasKey: false, hint: '' });
    },
    peekKey: () => secret,
    saveChatApiBase: (raw) => {
      const next = raw.trim().replace(/\/$/, '');
      if (!next) return false;
      writeJsonForced(CHAT_BASE_KEY, next);
      set({ chatApiBase: next });
      return true;
    },
    clearChatApiBase: () => {
      removeJson(CHAT_BASE_KEY);
      set({ chatApiBase: '' });
    },
  };
});

export function readVaultOpenAiKey(): string {
  return useVaultStore.getState().peekKey();
}

export function readVaultChatApiBase(): string {
  return useVaultStore.getState().chatApiBase.trim();
}
