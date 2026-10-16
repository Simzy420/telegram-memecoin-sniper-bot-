/** Menu tools without React icons — safe for stores and node tests. */
export type AiToolLink = {
  name: string;
  href: string;
};

export const AI_TOOL_LINKS: readonly AiToolLink[] = [
  { name: 'ChatGPT', href: 'https://chatgpt.com' },
  { name: 'Base44', href: 'https://base44.com' },
  { name: 'Cursor', href: 'https://cursor.com' },
  { name: 'Buffer', href: 'https://buffer.com' },
  { name: 'Linear', href: 'https://linear.app' },
  { name: 'Replit', href: 'https://replit.com' },
  { name: 'Perplexity', href: 'https://www.perplexity.ai' },
  { name: 'Link', href: 'https://apps.apple.com/app/id1623228342' },
];
