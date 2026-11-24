'use client';

import { useEffect } from 'react';

/**
 * Stops the mouse wheel (and trackpad scroll) from changing the value of a focused number field.
 * The user types numbers with the keyboard; scrolling over a field should just scroll the page.
 * One listener for the whole app, so every number input behaves the same, including future ones.
 */
export function NoWheelNumber() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === 'number' && el === document.activeElement) {
        // Losing focus is what stops the browser from stepping the value; the page still scrolls.
        el.blur();
      }
    };
    // Passive: we never block scrolling, we only drop focus.
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);
  return null;
}
