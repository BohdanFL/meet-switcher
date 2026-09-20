import { MEET_DICTIONARY } from './dictionary.ts';

/**
 * Pure functions to locate Google Meet DOM elements using the centralized dictionary.
 * Prioritizes fast, icon-based queries before falling back to regex evaluations.
 */
export const MeetSelectors = {
  /**
   * Finds the Pin button within a given container (e.g., a video tile or side panel row).
   */
  findPinButton(container: HTMLElement): HTMLButtonElement | null {
    if (!container.querySelectorAll) return null;

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button, [role="button"], div[tabindex="0"]'));

    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      // Ensure it's not an Unpin button first to avoid false positives
      if (
        MEET_DICTIONARY.ACTIONS.UNPIN.test(aria) ||
        MEET_DICTIONARY.ACTIONS.UNPIN.test(tooltip) ||
        text.includes(MEET_DICTIONARY.ICONS.UNPIN)
      ) {
        continue;
      }

      // Check for pin identifiers
      if (
        MEET_DICTIONARY.ACTIONS.PIN.test(aria) ||
        MEET_DICTIONARY.ACTIONS.PIN.test(tooltip) ||
        MEET_DICTIONARY.ACTIONS.PIN.test(text) || // text check for "keep" text
        text.includes(MEET_DICTIONARY.ICONS.PIN_OUTLINE) ||
        aria.includes(MEET_DICTIONARY.ICONS.PIN_OUTLINE)
      ) {
        return btn;
      }
    }
    return null;
  },

  /**
   * Finds the Unpin button within a given container.
   */
  findUnpinButton(container: HTMLElement): HTMLButtonElement | null {
    if (!container.querySelectorAll) return null;

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button, [role="button"], i'));

    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      if (
        MEET_DICTIONARY.ACTIONS.UNPIN.test(aria) ||
        MEET_DICTIONARY.ACTIONS.UNPIN.test(tooltip) ||
        text.includes(MEET_DICTIONARY.ICONS.UNPIN)
      ) {
        // Find the closest button if it's an <i> tag
        const buttonEl = btn.closest('button, [role="button"]');
        return (buttonEl as HTMLButtonElement) || (btn as HTMLButtonElement);
      }
    }
    return null;
  },

  /**
   * Finds the global unpin buttons currently visible on the document.
   */
  findGlobalUnpinButtons(doc: Document): HTMLButtonElement[] {
    if (!doc.querySelectorAll) return [];
    
    const unpinBtns: HTMLButtonElement[] = [];
    const globalButtons = Array.from(doc.querySelectorAll<HTMLButtonElement>('button, [role="button"], i'));
    
    for (const btn of globalButtons) {
      if (btn.offsetParent === null && btn.clientWidth === 0) continue;
      
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = btn.textContent || '';
      
      if (
        MEET_DICTIONARY.ACTIONS.UNPIN.test(label) ||
        MEET_DICTIONARY.ACTIONS.UNPIN.test(tooltip) ||
        text.includes(MEET_DICTIONARY.ICONS.UNPIN)
      ) {
        const buttonEl = btn.closest('button, [role="button"]');
        unpinBtns.push((buttonEl as HTMLButtonElement) || (btn as HTMLButtonElement));
      }
    }
    
    return unpinBtns;
  },

  /**
   * Finds the button used to open the People side panel.
   */
  findPeoplePanelBtn(doc: Document): HTMLButtonElement | null {
    if (!doc.querySelectorAll) return null;
    
    const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (MEET_DICTIONARY.PANELS.PEOPLE.test(aria)) {
        return btn;
      }
    }
    return null;
  },

  findPeoplePanel(doc: Document): HTMLElement | null {
    if (!doc.querySelector) return null;
    return (
      doc.querySelector<HTMLElement>('aside[aria-label*="Side panel" i], aside') ||
      doc.querySelector<HTMLElement>('div[aria-label*="People" i], div[aria-label*="учасник" i], div[aria-label*="люди" i]') ||
      doc.querySelector<HTMLElement>('[aria-label="In call"]')
    );
  }
};
