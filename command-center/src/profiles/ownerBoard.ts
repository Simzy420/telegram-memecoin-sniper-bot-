import { createStarterLayout } from '@/data/starterLayout';
import type { LayoutDocument } from '@/types/layout';

let ownerBoard: LayoutDocument | null = null;

/** Casey's shipped board. Visitors can view it. Signing in never writes this document. */
export function getOwnerBoard(): LayoutDocument {
  if (!ownerBoard) ownerBoard = createStarterLayout();
  return ownerBoard;
}
