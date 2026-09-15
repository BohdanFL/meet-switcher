import { ScreenShare } from '../types';
import { ScreenDetector } from './detector';
import { AnimationKiller } from './animation-killer';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';

export class PinController {
  private detector: ScreenDetector;
  private isSwitching = false;
  private animationKiller?: AnimationKiller;
  private logger = DiagnosticsLogger.getInstance();

  constructor(detector: ScreenDetector, animationKiller?: AnimationKiller) {
    this.detector = detector;
    this.animationKiller = animationKiller;
  }

  public setAnimationKiller(ak: AnimationKiller): void {
    this.animationKiller = ak;
  }

  public getAnimationKiller(): AnimationKiller | undefined {
    return this.animationKiller;
  }

  public hasPinnedStream(): boolean {
    return this.detector.isAnyStreamPinned();
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
      this.detector.markAllUnpinned();
      setTimeout(() => this.detector.scan(), 100);
      return true;
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Core switching logic: If already pinned -> Unpin (toggle). Otherwise unpin others and pin target.
   * Resilient to Google Meet's 3-tile sidebar overflow by unpinning to expand the full grid when needed.
   */
  public async switchToShare(target: ScreenShare): Promise<boolean> {
    if (this.isSwitching) return false;
    this.isSwitching = true;

    try {
      // Toggle behavior: If this exact share is ALREADY pinned, unpin it!
      if (target.isPinned) {
        console.log(`[MeetSwitcher] "${target.participantName}" is already pinned. Unpinning...`);
        this.logger.log('ACTION', `Unpinned active stream: "${target.participantName}"`);
        await this.unpinActiveStreams();
        this.detector.markAllUnpinned();
        setTimeout(() => this.detector.scan(), 50);
        return true;
      }

      // Check whether target tile is currently in DOM and visible
      let currentTile = target.tileElement;
      let isInDom = Boolean(
        currentTile &&
        document.body.contains(currentTile) &&
        currentTile.getBoundingClientRect().width > 0
      );

      this.logger.log('ACTION', `Request switch to [${target.index}] "${target.participantName}"`, {
        targetId: target.id,
        isInDom,
      });

      // If off-screen (because Google Meet in sidebar mode only renders ~3 tiles):
      if (!isInDom) {
        console.log(
          `[MeetSwitcher] Tile for "${target.participantName}" is off-screen. Expanding Meet grid...`
        );
        this.logger.log('ACTION', `Tile off-screen in sidebar, expanding grid for "${target.participantName}"`);
        await this.unpinActiveStreams();
        this.detector.markAllUnpinned();

        // Google Meet needs 200-400ms to reflow and mount all tiles into the DOM.
        // Poll with retries for up to 800ms (16 attempts * 50ms)
        const targetNorm = this.detector.normalizeParticipantName(target.participantName);
        for (let attempt = 0; attempt < 16; attempt++) {
          await this.sleep(50);
          const fresh = this.detector.scan();
          const refreshed = fresh.find((s) =>
            s.id === target.id ||
            s.index === target.index ||
            this.detector.normalizeParticipantName(s.participantName) === targetNorm
          );
          if (refreshed?.tileElement && document.body.contains(refreshed.tileElement)) {
            currentTile = refreshed.tileElement;
            target = refreshed;
            isInDom = true;
            break;
          }
        }
      }

      if (!currentTile || !document.body.contains(currentTile)) {
        const snap = this.logger.captureDomSnapshot(this.hasPinnedStream());
        this.logger.recordSwitch(target.participantName, target.index, false, 'Tile not in DOM');
        this.logger.log('ERROR', `Could not locate tile for "${target.participantName}"`, { targetId: target.id }, snap);
        console.warn(`[MeetSwitcher] Could not locate tile for "${target.participantName}"`);
        return false;
      }

      // Notify detector about who is expected to be pinned on center stage
      this.detector.setExpectedPinnedParticipant(target.participantName);

      // 1. Ensure target tile has valid geometry
      await this.ensureTileVisible(currentTile);

      // 2. Hover over the target tile to reveal Meet action buttons
      this.hoverTile(currentTile);

      // 3. Locate Pin button on target tile with retries
      let pinBtn = this.detector.findPinButton(currentTile);

      if (!pinBtn) {
        for (let i = 0; i < 6; i++) {
          await this.sleep(40);
          this.hoverTile(currentTile);
          pinBtn = this.detector.findPinButton(currentTile);
          if (pinBtn) break;
        }
      }

      // FAST PATH: Pin directly
      if (pinBtn) {
        console.log(`[MeetSwitcher] Pinning presentation "${target.participantName}"...`);
        this.logger.log('ACTION', `Dispatched Pin click on tile for "${target.participantName}"`);
        this.dispatchFullClick(pinBtn);

        // Crucial: check host popup menu ("For myself only" vs "For everyone")
        await this.handlePinMenuIfOpened();
        this.logger.recordSwitch(target.participantName, target.index, true);

        // Clean up any previously pinned screens (if multi-pin kept them)
        const allShares = this.detector.getScreenShares();
        for (const share of allShares) {
          if (share.id !== target.id && share.isPinned && share.tileElement) {
            this.hoverTile(share.tileElement);
            const otherUnpin = this.detector.findUnpinButton(share.tileElement);
            if (otherUnpin) {
              this.dispatchFullClick(otherUnpin);
            }
          }
        }

        setTimeout(() => this.detector.scan(), 50);
        return true;
      }

      // FALLBACK PATH: Unpin active streams and retry
      console.log(`[MeetSwitcher] Direct pin not found, unpinning active streams and retrying...`);
      this.logger.log('ACTION', `Direct pin button not found, falling back to global unpin and retry for "${target.participantName}"`);
      await this.unpinActiveStreams();
      this.detector.markAllUnpinned();

      const targetNorm = this.detector.normalizeParticipantName(target.participantName);
      let retryTile: HTMLElement | null = null;
      for (let attempt = 0; attempt < 10; attempt++) {
        await this.sleep(50);
        const refreshedShares = this.detector.scan();
        const ref = refreshedShares.find((s) =>
          s.id === target.id ||
          s.index === target.index ||
          this.detector.normalizeParticipantName(s.participantName) === targetNorm
        );
        if (ref?.tileElement && document.body.contains(ref.tileElement)) {
          retryTile = ref.tileElement;
          break;
        }
      }
      if (!retryTile) {
        retryTile = currentTile;
      }

      if (retryTile && document.body.contains(retryTile)) {
        await this.ensureTileVisible(retryTile);
        this.hoverTile(retryTile);
        pinBtn = this.detector.findPinButton(retryTile);

        if (pinBtn) {
          this.logger.log('ACTION', `Dispatched retry Pin click on tile for "${target.participantName}"`);
          this.dispatchFullClick(pinBtn);
          await this.handlePinMenuIfOpened();
          this.logger.recordSwitch(target.participantName, target.index, true);
          setTimeout(() => this.detector.scan(), 50);
          return true;
        }
      }

      const snap = this.logger.captureDomSnapshot(this.hasPinnedStream());
      this.logger.recordSwitch(target.participantName, target.index, false, 'Pin button not found after retry');
      this.logger.log('ERROR', `Pin button not found on tile for "${target.participantName}"`, { targetId: target.id }, snap);
      console.warn(`[MeetSwitcher] Pin button not found on tile for "${target.participantName}"`);
      return false;
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
      if (share.isPinned && share.tileElement && document.body.contains(share.tileElement)) {
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
          tooltip.includes('открепить') ||
          text.includes('keep_off')
        ) {
          this.dispatchFullClick(btn);
          break;
        }
      }
    }

    this.detector.markAllUnpinned();
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

    for (let i = 0; i < 4; i++) {
      const rect = tile.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 10) {
        return true;
      }
      await this.sleep(25);
    }
    return false;
  }

  /**
   * Google Meet for hosts/moderators opens a menu: "For myself only" vs "For everyone".
   * STRICT SAFETY: NEVER clicks "For everyone" / "Для всіх".
   * Selects "For myself only" / "Лише для мене".
   */
  private async handlePinMenuIfOpened(): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      await this.sleep(40);

      const menus = Array.from(
        document.querySelectorAll<HTMLElement>(
          'div[role="menu"], ul[role="menu"], div[role="dialog"], div.VfPpkd-xl07Ob-XxIAqe'
        )
      );

      for (const menu of menus) {
        if (menu.offsetWidth === 0 && menu.offsetHeight === 0) continue;

        const items = Array.from(
          menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], button, li')
        );

        if (items.length === 0) continue;

        this.logger.log('MENU', `Host pin menu appeared with ${items.length} options`, {
          options: items.map((i) => i.textContent?.trim() || i.getAttribute('aria-label') || ''),
        });

        const forMyselfRegex = /(?:myself|for me|мене|себе|себя)/i;
        const forEveryoneRegex = /(?:everyone|all|всіх|всех)/i;

        // 1. Direct match: specifically target "Лише для мене" / "For myself only"
        for (const item of items) {
          const text = (item.textContent || '').trim().toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();

          if (
            (forMyselfRegex.test(text) || forMyselfRegex.test(aria)) &&
            !forEveryoneRegex.test(text) &&
            !forEveryoneRegex.test(aria)
          ) {
            console.log(
              `[MeetSwitcher] Selected host pin option: "For myself only" ("${item.textContent?.trim()}")`
            );
            this.logger.log('MENU', `Selected "For myself only" option: "${item.textContent?.trim()}"`);
            this.dispatchFullClick(item);
            return true;
          }
        }

        // 2. Safe fallback: pick the option that does NOT contain "everyone" / "для всіх"
        const safeItems = items.filter((item) => {
          const text = (item.textContent || '').trim().toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();
          return !forEveryoneRegex.test(text) && !forEveryoneRegex.test(aria);
        });

        if (safeItems.length > 0) {
          console.log(
            `[MeetSwitcher] Selected safe non-everyone pin option: "${safeItems[0].textContent?.trim()}"`
          );
          this.logger.log('MENU', `Selected safe fallback option: "${safeItems[0].textContent?.trim()}"`);
          this.dispatchFullClick(safeItems[0]);
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
