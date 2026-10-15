export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  botId?: string;
  text: string;
  createdAt: number;
}

export interface ChatStreamInput {
  botId: string;
  botName: string;
  messages: ChatMessage[];
  userText: string;
}

/** Swap this implementation for a real provider later. */
export interface ChatAdapter {
  id: string;
  label: string;
  streamReply(input: ChatStreamInput): AsyncIterable<string>;
}
