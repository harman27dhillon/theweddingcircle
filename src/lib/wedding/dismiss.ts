import { useEffect, useRef, type RefObject } from "react";

/**
 * Closes a compact popup on an outside tap or Escape.
 * The outside tap is swallowed so it cannot activate a control underneath.
 * Roots include the trigger and the popup, including a portaled menu.
 */
export function useDismissible(open: boolean, onClose: () => void, ...roots: Array<RefObject<HTMLElement | null>>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const rootsRef = useRef(roots);
  rootsRef.current = roots;

  useEffect(() => {
    if (!open) return;
    let swallow = false;
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      return rootsRef.current.some((root) => root.current?.contains(target));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (inside(event.target)) return;
      swallow = true;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      if (inside(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
}
