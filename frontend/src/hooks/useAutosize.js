import { useLayoutEffect } from 'react';

// Auto-grow a textarea up to its max-height.
export function useAutosize(ref, value) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}
