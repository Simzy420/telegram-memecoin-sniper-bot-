import type { ChatAdapter } from './types';
import { bridgeChatAdapter } from './bridge';
import { mockChatAdapter } from './mock';

export function getChatAdapter(): ChatAdapter {
  if (import.meta.env.VITE_CHAT_MOCK === '1') return mockChatAdapter;
  return bridgeChatAdapter;
}

/** Default is the real Chief of Staff bridge. Mock only when VITE_CHAT_MOCK=1. */
export const chatAdapter: ChatAdapter = getChatAdapter();

export {
  bridgeChatAdapter,
  DEFAULT_CHAT_API_BASE,
  isChatBridgeConfigured,
  resolveChatApiBase,
  getChatSessionId,
} from './bridge';
export { mockChatAdapter } from './mock';

export type { ChatAdapter, ChatMessage, ChatStreamInput } from './types';
