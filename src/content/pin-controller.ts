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

      // Step 2: Allow Google Meet layout animation to settle
      await this.sleep(60);

      // Step 3: Trigger mouseover/focus to reveal target buttons
      this.hoverTile(target.tileElement);

      // Step 4: Locate Pin button and click it
      let pinBtn = this.detector.findPinButton(target.tileElement);

      // Retry up to 3 times with brief delays if Meet hasn't rendered buttons yet
      if (!pinBtn) {
        for (let i = 0; i < 3; i++) {
          await this.sleep(50);
          this.hoverTile(target.tileElement);
          pinBtn = this.detector.findPinButton(target.tileElement);
          if (pinBtn) break;
        }
      }

      if (pinBtn) {
        pinBtn.click();
        // Trigger a rescanned state update
        setTimeout(() => this.detector.scan(), 100);
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
    for (const share of shares) {
      if (share.isPinned) {
        this.hoverTile(share.tileElement);
        const unpinBtn = this.detector.findUnpinButton(share.tileElement);
        if (unpinBtn) {
          unpinBtn.click();
        }
      }
    }

    // 2. Global fallback check for any Unpin button in document
    const globalButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of globalButtons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = btn.textContent || '';

      if (
        label.includes('unpin') ||
        label.includes('відкріпити') ||
        tooltip.includes('unpin') ||
        tooltip.includes('відкріпити') ||
        text.includes('keep_off')
      ) {
        btn.click();
      }
    }
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
