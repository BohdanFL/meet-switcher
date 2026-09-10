import { ScreenShare } from '../types';
import { ScreenDetector } from './detector';

export class PinController {
  private detector: ScreenDetector;
  private isSwitching = false;

  constructor(detector: ScreenDetector) {
    this.detector = detector;
  }

  /**
   * Switch directly to a screen share by 1-based index (1..9).
   */
  public async switchToIndex(index: number): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    const target = shares.find((s) => s.index === index);
    if (!target) {
      console.warn(`[MeetSwitcher] No screen share found with index ${index}`);
      return false;
    }
    return this.switchToShare(target);
  }

  /**
   * Switch to the next available screen share cyclically.
   */
  public async switchNext(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;

    const currentPinnedIndex = shares.findIndex((s) => s.isPinned);
    const nextIndex = currentPinnedIndex === -1 ? 0 : (currentPinnedIndex + 1) % shares.length;
    return this.switchToShare(shares[nextIndex]);
  }

  /**
   * Switch to the previous available screen share cyclically.
   */
  public async switchPrevious(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;

    const currentPinnedIndex = shares.findIndex((s) => s.isPinned);
    const prevIndex =
      currentPinnedIndex === -1 ? shares.length - 1 : (currentPinnedIndex - 1 + shares.length) % shares.length;
    return this.switchToShare(shares[prevIndex]);
  }

  /**
   * Explicitly unpin any currently pinned stream (returns Meet to standard grid).
   */
  public async unpin(): Promise<boolean> {
    if (this.isSwitching) return false;
    this.isSwitching = true;

    try {
      await this.unpinActiveStreams();
      setTimeout(() => this.detector.scan(), 150);
      return true;
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Core switching logic: If already pinned -> Unpin (toggle). Otherwise unpin others and pin target.
   */
  public async switchToShare(target: ScreenShare): Promise<boolean> {
    if (this.isSwitching) return false;
    this.isSwitching = true;

    try {
      // Toggle behavior: If this exact share is ALREADY pinned, unpin it!
      if (target.isPinned) {
        console.log(`[MeetSwitcher] "${target.participantName}" is already pinned. Unpinning...`);
        await this.unpinActiveStreams();
        setTimeout(() => this.detector.scan(), 150);
        return true;
      }

      // Step 1: Unpin any currently pinned screen
      await this.unpinActiveStreams();

      // Step 2: Allow Google Meet layout animation & reflow to settle
      await this.sleep(120);

      // Step 3: Ensure target tile is in view and has valid geometry
      await this.ensureTileVisible(target.tileElement);

      // Step 4: Hover over the tile with real coordinates
      this.hoverTile(target.tileElement);
      await this.sleep(50);

      // Step 5: Locate Pin button
      let pinBtn = this.detector.findPinButton(target.tileElement);

      // Retry up to 4 times with small delays while re-hovering
      if (!pinBtn) {
        for (let i = 0; i < 4; i++) {
          await this.sleep(60);
          this.hoverTile(target.tileElement);
          pinBtn = this.detector.findPinButton(target.tileElement);
          if (pinBtn) break;
        }
      }

      if (pinBtn) {
        console.log(`[MeetSwitcher] Clicking Pin button on "${target.participantName}"...`);
        this.dispatchFullClick(pinBtn);

        // Step 6: Handle Google Meet host popup menu ("For myself only" vs "For everyone")
        await this.handlePinMenuIfOpened();

        // Step 7: Rescan detector state
        setTimeout(() => this.detector.scan(), 150);
        return true;
      } else {
        console.warn(`[MeetSwitcher] Pin button not found on tile for "${target.participantName}"`);
        return false;
      }
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Unpin any currently pinned tiles in the meeting.
   */
  public async unpinActiveStreams(): Promise<void> {
    const shares = this.detector.getScreenShares();
    let unpinned = false;

    // 1. Try unpinning known shares from detector
    for (const share of shares) {
      if (share.isPinned) {
        this.hoverTile(share.tileElement);
        const unpinBtn = this.detector.findUnpinButton(share.tileElement);
        if (unpinBtn) {
          this.dispatchFullClick(unpinBtn);
          unpinned = true;
        }
      }
    }

    // 2. Fallback: Search globally for any active unpin button on the main stage
    if (!unpinned) {
      const globalButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      for (const btn of globalButtons) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
        const text = btn.textContent || '';

        if (
          label.includes('unpin') ||
          label.includes('відкріпити') ||
          label.includes('открепить') ||
          tooltip.includes('unpin') ||
          tooltip.includes('відкріпити') ||
          text.includes('keep_off')
        ) {
          this.dispatchFullClick(btn);
          break;
        }
      }
    }
  }

  /**
   * Dispatches realistic Pointer & Mouse events with real center coordinates.
   * Google Meet's internal JSAction requires real event sequences to execute clicks.
   */
  private dispatchFullClick(element: HTMLElement): void {
    try {
      element.focus();
    } catch {
      // Ignore focus errors
    }

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX || 100,
      clientY: clientY || 100,
      button: 0,
    };

    element.dispatchEvent(new PointerEvent('pointerdown', eventInit));
    element.dispatchEvent(new MouseEvent('mousedown', eventInit));
    element.dispatchEvent(new PointerEvent('pointerup', eventInit));
    element.dispatchEvent(new MouseEvent('mouseup', eventInit));
    element.dispatchEvent(new MouseEvent('click', eventInit));
  }

  /**
   * Ensure tile has non-zero dimensions before interacting.
   */
  private async ensureTileVisible(tile: HTMLElement): Promise<boolean> {
    try {
      tile.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch {
      // Ignore scroll errors
    }

    for (let i = 0; i < 5; i++) {
      const rect = tile.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        return true;
      }
      await this.sleep(40);
    }
    return false;
  }

  /**
   * Google Meet for hosts/moderators opens a menu: "For myself only" vs "For everyone".
   * This helper checks if a menu appeared and auto-selects "For myself only".
   */
  private async handlePinMenuIfOpened(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      await this.sleep(40);

      const menus = Array.from(
        document.querySelectorAll<HTMLElement>('div[role="menu"], ul[role="menu"], div[role="dialog"]')
      );

      for (const menu of menus) {
        if (menu.offsetWidth === 0 && menu.offsetHeight === 0) continue;

        const items = Array.from(
          menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], button, li')
        );

        // First pass: look specifically for "myself" / "для себе" / "для себя"
        for (const item of items) {
          const text = (item.textContent || '').toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').toLowerCase();

          if (
            text.includes('myself') ||
            text.includes('для себе') ||
            text.includes('для себя') ||
            aria.includes('myself') ||
            aria.includes('для себе') ||
            aria.includes('для себя')
          ) {
            this.dispatchFullClick(item);
            return true;
          }
        }

        // Second pass: click the 1st option if menu appeared
        if (items.length > 0) {
          this.dispatchFullClick(items[0]);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Hover over a tile element with real coordinates to trigger Meet's action buttons.
   */
  private hoverTile(element: HTMLElement): void {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;

    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX || 100,
      clientY: clientY || 100,
    };

    const mouseEvents = ['mouseenter', 'mouseover', 'mousemove'];
    for (const type of mouseEvents) {
      element.dispatchEvent(new MouseEvent(type, eventInit));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
