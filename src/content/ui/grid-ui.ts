import { DiagnosticsLogger } from '../../diagnostics/logger.ts';
import type { ScreenShare } from '../../types/index.ts';
import { MeetSelectors } from './selectors.ts';
import { MEET_DICTIONARY } from './dictionary.ts';
import { dispatchFullClick, hoverTile, sleep } from './dom-utils.ts';

export class MeetGridUI {
  private logger: DiagnosticsLogger;

  constructor(logger: DiagnosticsLogger) {
    this.logger = logger;
  }

  /**
   * Ensure tile has non-zero dimensions before interacting.
   */
  public async ensureTileVisible(tile: HTMLElement): Promise<boolean> {
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
      await sleep(25);
    }
    return false;
  }

  /**
   * Google Meet for hosts/moderators opens a menu: "For myself only" vs "For everyone".
   * STRICT SAFETY: NEVER clicks "For everyone" / "Всі".
   * Selects "For myself only" / "Лише для мене".
   */
  public async handlePinMenuIfOpened(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): Promise<boolean> {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelectorAll) return false;

    for (let i = 0; i < 5; i++) {
      await sleep(40);

      const menus = Array.from(
        targetDoc.querySelectorAll<HTMLElement>(
          'div[role="menu"], ul[role="menu"], div.VfPpkd-xl07Ob-XxIAqe'
        )
      );

      for (const menu of menus) {
        if (menu.offsetWidth === 0 && menu.offsetHeight === 0) continue;

        const items = Array.from(
          menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="option"], button, li')
        );

        if (items.length === 0) continue;

        const forMyselfRegex = MEET_DICTIONARY.HOST_PIN_MENU.FOR_MYSELF_ONLY;
        const forEveryoneRegex = MEET_DICTIONARY.HOST_PIN_MENU.FOR_EVERYONE;

        const hasHostPinOption = items.some((item) => {
          const text = (item.textContent || '').trim().toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();
          return forMyselfRegex.test(text) || forMyselfRegex.test(aria) || forEveryoneRegex.test(text) || forEveryoneRegex.test(aria);
        });

        if (!hasHostPinOption) {
          continue;
        }

        this.logger.log('MENU', `Host pin menu appeared with ${items.length} options`, {
          options: items.map((i) => i.textContent?.trim() || i.getAttribute('aria-label') || ''),
        });

        // 1. Direct match: specifically target "For myself only"
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
            dispatchFullClick(item);
            return true;
          }
        }

        // 2. Safe fallback ONLY if the menu had an explicit "for everyone" option:
        const hasEveryone = items.some((item) => {
          const text = (item.textContent || '').trim().toLowerCase();
          const aria = (item.getAttribute('aria-label') || '').trim().toLowerCase();
          return forEveryoneRegex.test(text) || forEveryoneRegex.test(aria);
        });

        if (hasEveryone) {
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
            dispatchFullClick(safeItems[0]);
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Hover over tile, wait for pin button, and click it. Handles the host pin menu.
   */
  public async pinTile(tile: HTMLElement, participantName: string): Promise<boolean> {
    hoverTile(tile);
    let pinBtn = MeetSelectors.findPinButton(tile);

    if (!pinBtn) {
      for (let i = 0; i < 6; i++) {
        await sleep(40);
        hoverTile(tile);
        pinBtn = MeetSelectors.findPinButton(tile);
        if (pinBtn) break;
      }
    }

    if (pinBtn) {
      console.log(`[MeetSwitcher] Pinning presentation "${participantName}"...`);
      this.logger.log('ACTION', `Dispatched Pin click on tile for "${participantName}"`);
      dispatchFullClick(pinBtn);
      await this.handlePinMenuIfOpened();
      return true;
    }

    return false;
  }

  /**
   * Finds all unpin buttons on all active streams and clicks them.
   */
  public async unpinAll(shares: ScreenShare[]): Promise<boolean> {
    let unpinnedCount = 0;
    for (const share of shares) {
      if (share.isPinned && share.tileElement) {
        hoverTile(share.tileElement);
        await sleep(40);
        const unpinBtn = MeetSelectors.findUnpinButton(share.tileElement);
        if (unpinBtn) {
          dispatchFullClick(unpinBtn);
          unpinnedCount++;
        }
      }
    }
    
    if (unpinnedCount === 0) {
      const globalButtons = MeetSelectors.findGlobalUnpinButtons(typeof document !== 'undefined' ? document : ({} as any));
      for (const btn of globalButtons) {
        dispatchFullClick(btn);
        unpinnedCount++;
      }
    }
    
    return unpinnedCount > 0;
  }

  /**
   * Helper to click an unpin button on a single tile if visible.
   */
  public async unpinTile(tile: HTMLElement): Promise<boolean> {
    hoverTile(tile);
    await sleep(40);
    const unpinBtn = MeetSelectors.findUnpinButton(tile);
    if (unpinBtn) {
      dispatchFullClick(unpinBtn);
      return true;
    }
    return false;
  }
}
