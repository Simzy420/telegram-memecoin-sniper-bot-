import type { FileNode } from './filesStore';

/** Stay under a typical localStorage quota shared with the rest of the board. */
export const MAX_FILE_CHARS = 100_000;

export function applyFileSave(
  nodes: FileNode[],
  id: string,
  content: string,
  now = Date.now(),
): { ok: true; nodes: FileNode[] } | { ok: false; error: string } {
  if (typeof content !== 'string') return { ok: false, error: 'File contents must be text.' };
  if (content.length > MAX_FILE_CHARS) {
    return { ok: false, error: 'This file is too long to keep on this device.' };
  }
  const current = nodes.find((node) => node.id === id && node.kind === 'file');
  if (!current) return { ok: false, error: 'That file is not on this device.' };
  return {
    ok: true,
    nodes: nodes.map((node) => (node.id === id ? { ...node, content, updatedAt: now } : node)),
  };
}
