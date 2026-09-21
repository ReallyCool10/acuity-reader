import { useEffect, type RefObject } from 'react';

/**
 * Closes a popover on outside pointer-down or Escape.
 *
 * Uses pointerdown rather than click so the menu dismisses on press, matching
 * native menu behaviour, and listens in the capture phase so a stopPropagation
 * inside the popover's own content cannot strand it open.
 */
export function useDismissable(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!isOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [ref, isOpen, onDismiss]);
}
