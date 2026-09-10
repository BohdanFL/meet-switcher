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
   * Core switching logic: Unpin current active tile and pin target tile.
   */
  public async switchToShare(target: ScreenShare): Promise<boolean> {
    if (this.isSwitching) return false;
    this.isSwitching = true;

    try {
      // If target is already pinned, nothing to do
      if (target.isPinned) {
        return true;
      }

      // Step 1: Unpin currently pinned screen (if any)
      await this.unpinActiveStreams();

      // Step 2: Allow Google Meet layout animation & reflow to settle (prevents scale(Infinity) on 0px tiles)
      await this.sleep(120);

      // Step 3: Ensure target tile is rendered and has valid dimensions
      await this.ensureTileVisible(target.tileElement);

      // Step 4: Hover over the tile to make Meet render action buttons
      this.hoverTile(target.tileElement);
      await this.sleep(40);

      // Step 5: Locate Pin button and click it
      let pinBtn = this.detector.findPinButton(target.tileElement);

      // Retry if Meet hasn't rendered buttons yet
      if (!pinBtn) {
        for (let i = 0; i < 4; i++) {
          await this.sleep(50);
          this.hoverTile(target.tileElement);
          pinBtn = this.detector.findPinButton(target.tileElement);
          if (pinBtn) break;
        }
      }

      if (pinBtn) {
        pinBtn.click();

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
    // 1. Check known shares from detector
    const shares = this.detector.getScreenShares();
    let unpinned = false;

    for (const share of shares) {
      if (share.isPinned) {
        this.hoverTile(share.tileElement);
        const unpinBtn = this.detector.findUnpinButton(share.tileElement);
        if (unpinBtn) {
          unpinBtn.click();
          unpinned = true;
        }
      }
    }

    // 2. Global fallback check only if no share was explicitly unpinned
    if (!unpinned) {
      const globalButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      for (const btn of globalButtons) {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

        if (
          label.includes('unpin') ||
          label.includes('відкріпити') ||
          label.includes('открепить') ||
          tooltip.includes('unpin') ||
          tooltip.includes('відкріпити')
        ) {
          btn.click();
        }
      }
    }
  }

  /**
   * Ensure tile has non-zero dimensions to prevent Google Meet transform animations from crashing.
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
    // Wait briefly for menu to mount in DOM
    for (let i = 0; i < 6; i++) {
      await this.sleep(40);

      const menus = Array.from(
        document.querySelectorAll<HTMLElement>('div[role="menu"], ul[role="menu"], div[role="dialog"]')
      );

      for (const menu of menus) {
        // Skip hidden menus
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
            item.click();
            return true;
          }
        }

        // Second pass: if specific wording wasn't matched but a pin menu opened, click the 1st option
        if (items.length > 0) {
          items[0].click();
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Hover over a tile element to make Meet render hovering overlay action buttons.
   */
  private hoverTile(element: HTMLElement): void {
    const mouseEvents = ['mouseenter', 'mouseover', 'mousemove'];
    for (const type of mouseEvents) {
      element.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
