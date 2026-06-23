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
      let result = applyPatch(activeCode, item.patchDelta);
      if (result === false) {
        // Retry with a higher fuzzFactor to tolerate minor changes or parameter updates
        result = applyPatch(activeCode, item.patchDelta, { fuzzFactor: 3 });
      }
      if (result === false) {
        console.warn(`[reconstructHistory] Patch failed to apply for item ${item.id}. Falling back to previous step code.`);
        result = activeCode;
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
