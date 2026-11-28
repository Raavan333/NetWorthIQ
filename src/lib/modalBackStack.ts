import { useEffect, useRef } from 'react';

interface BackStackEntry {
  id: number;
  handler: () => boolean | void;
  handleEscape: boolean;
}

let nextEntryId = 1;
const backStack: BackStackEntry[] = [];
let globalListenersAttached = false;

export function handleAppBack(): 'handled' | 'exit' {
  for (let i = backStack.length - 1; i >= 0; i--) {
    const entry = backStack[i];
    const res = entry.handler();
    if (res !== false) {
      return 'handled';
    }
  }
  return 'exit';
}

function attachGlobalListeners() {
  if (globalListenersAttached || typeof window === 'undefined') return;
  globalListenersAttached = true;

  (window as unknown as { __networthiqHandleBack?: () => 'handled' | 'exit' }).__networthiqHandleBack =
    handleAppBack;

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    for (let i = backStack.length - 1; i >= 0; i--) {
      const entry = backStack[i];
      if (!entry.handleEscape) continue;
      const res = entry.handler();
      if (res !== false) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  });
}

export function registerBackHandler(
  onBack: () => boolean | void,
  handleEscape: boolean = true
): () => void {
  const id = nextEntryId++;
  const entry: BackStackEntry = {
    id,
    handler: onBack,
    handleEscape,
  };
  backStack.push(entry);

  return () => {
    const idx = backStack.findIndex((item) => item.id === id);
    if (idx !== -1) {
      backStack.splice(idx, 1);
    }
  };
}

/**
 * Registers an active overlay/drawer/modal or root-tab back handler on a LIFO stack.
 * Both Android hardware Back button and keyboard Escape dismiss only the top-most layer.
 */
export function useBackDismiss(
  isOpen: boolean,
  onBack: () => boolean | void,
  options?: { handleEscape?: boolean }
) {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const handleEscape = options?.handleEscape ?? true;

  useEffect(() => {
    if (!isOpen) return;
    attachGlobalListeners();
    return registerBackHandler(() => onBackRef.current(), handleEscape);
  }, [isOpen, handleEscape]);
}
