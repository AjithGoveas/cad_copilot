import { applyPatch } from 'diff';

interface HistoryItemInput {
  id: string;
  isFullSnapshot: boolean;
  openscadCode: string | null;
  patchDelta: string | null;
  [key: string]: any;
}

/**
 * Reconstructs the full openscadCode for a list of history items.
 * Assumes the history items are sorted chronologically (createdAt: asc).
 * Returns the same array structure with openscadCode populated for all items.
 */
export function reconstructHistory<T extends HistoryItemInput>(items: T[]): (T & { openscadCode: string })[] {
  let activeCode = '';
  
  return items.map((item) => {
    let itemCode = '';
    if (item.isFullSnapshot) {
      itemCode = item.openscadCode || '';
      activeCode = itemCode;
    } else if (item.patchDelta) {
      const result = applyPatch(activeCode, item.patchDelta);
      if (result === false) {
        throw new Error(`Patch sync collision: Corrupt historical delta trail encountered at item ${item.id}`);
      }
      itemCode = result;
      activeCode = itemCode;
    }
    
    return {
      ...item,
      openscadCode: itemCode,
    };
  });
}
