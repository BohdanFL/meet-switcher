/**
 * Dispatches realistic Pointer & Mouse events with real center coordinates.
 * Google Meet's internal JSAction requires real event sequences to execute clicks.
 */
export function dispatchFullClick(element: HTMLElement): void {
  try {
    element.focus?.();
  } catch {
    // Ignore focus errors
  }

  const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 };
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const win = typeof window !== 'undefined' ? window : undefined;
  const eventInit: any = {
    bubbles: true,
    cancelable: true,
    view: win,
    clientX: clientX || 100,
    clientY: clientY || 100,
    button: 0,
  };

  try {
    if (typeof PointerEvent !== 'undefined') {
      element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    }
    if (typeof MouseEvent !== 'undefined') {
      element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    }
    if (typeof PointerEvent !== 'undefined') {
      element.dispatchEvent(new PointerEvent('pointerup', eventInit));
    }
    if (typeof MouseEvent !== 'undefined') {
      element.dispatchEvent(new MouseEvent('mouseup', eventInit));
      element.dispatchEvent(new MouseEvent('click', eventInit));
    } else if (element.dispatchEvent) {
      element.dispatchEvent({ type: 'click', ...eventInit } as any);
    }
  } catch {
    try {
      (element as any).click?.();
    } catch {
      // Ignore fallback click errors
    }
  }
}

/**
 * Hover over a tile element with real coordinates to trigger Meet's action buttons.
 */
export function hoverTile(element: HTMLElement): void {
  const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 };
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const win = typeof window !== 'undefined' ? window : undefined;
  const eventInit: any = {
    bubbles: true,
    cancelable: true,
    view: win,
    clientX: clientX || 100,
    clientY: clientY || 100,
  };

  const mouseEvents = ['mouseenter', 'mouseover', 'mousemove'];
  for (const type of mouseEvents) {
    try {
      if (typeof MouseEvent !== 'undefined') {
        element.dispatchEvent(new MouseEvent(type, eventInit));
      } else if (element.dispatchEvent) {
        element.dispatchEvent({ type, ...eventInit } as any);
      }
    } catch {
      // Ignore hover errors in non-browser env
    }
  }
}

/**
 * Utility to pause execution for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
