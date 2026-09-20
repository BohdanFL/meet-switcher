import type { ScreenShare } from '../types/index.ts';
import { ScreenDetector } from './detector.ts';
import { MEET_DICTIONARY } from './ui/dictionary.ts';
import { MeetSelectors } from './ui/selectors.ts';
import { AnimationKiller } from './animation-killer.ts';
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

  public getDetector(): ScreenDetector {
    return this.detector;
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
      this.logger.log('WARN', `Attempted switch to slot [${index}], but no participant found in this slot`, {
        availableSlots: shares.map((s) => ({ index: s.index, name: s.participantName })),
      });
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
    if (this.isSwitching) {
      this.logger.log('WARN', 'Unpin request ignored: another switch operation is already active');
      return false;
    }
    this.isSwitching = true;

    try {
      await this.unpinActiveStreams();
      this.detector.markAllUnpinned();
      setTimeout(() => this.detector.scan(), 150);
      setTimeout(() => this.detector.scan(), 550);
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
    if (this.isSwitching) {
      this.logger.log('WARN', `Switch to [${target.index}] "${target.participantName}" ignored: another switch operation is already active`);
      return false;
    }
    this.isSwitching = true;
    const switchStartTime = Date.now();

    try {
      // Toggle behavior: If this exact share is ALREADY pinned, unpin it!
      if (target.isPinned) {
        console.log(`[MeetSwitcher] "${target.participantName}" is already pinned. Unpinning...`);
        this.logger.log('ACTION', `Unpinned active stream: "${target.participantName}"`);
        await this.unpinActiveStreams();
        this.detector.markAllUnpinned();
        setTimeout(() => this.detector.scan(), 150);
        setTimeout(() => this.detector.scan(), 550);
        return true;
      }

      // Clear any unpin suppression since we are intentionally pinning a target
      this.detector.clearUnpinnedSuppress();

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
        this.logger.log('ACTION', `Tile off-screen, attempting People panel pinning for "${target.participantName}"`);

        const pinnedViaPanel = await this.pinViaPeoplePanel(target.participantName);
        if (pinnedViaPanel) {
          const elapsedMs = Date.now() - switchStartTime;
          this.logger.recordSwitch(target.participantName, target.index, true);
          this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" via People panel in ${elapsedMs}ms`);

          // Clean up any previously pinned screens (if multi-pin kept them)
          const allShares = this.detector.getScreenShares();
          for (const share of allShares) {
            if (share.id !== target.id && share.isPinned && share.tileElement && document.body?.contains(share.tileElement)) {
              this.hoverTile(share.tileElement);
              await this.sleep(40);
              const otherUnpin = MeetSelectors.findUnpinButton(share.tileElement);
              if (otherUnpin) {
                this.dispatchFullClick(otherUnpin);
              }
            }
          }

          setTimeout(() => this.detector.scan(), 100);
          return true;
        }

        console.log(
          `[MeetSwitcher] People panel pinning unavailable or failed for "${target.participantName}". Expanding Meet grid...`
        );
        this.logger.log('ACTION', `People panel pinning failed, expanding grid for "${target.participantName}"`);
        await this.unpinActiveStreams();
        this.detector.markAllUnpinned();

        // Google Meet needs 200-400ms to reflow and mount all tiles into the DOM.
        // Poll with retries for up to 800ms (16 attempts * 50ms)
        const targetNorm = this.detector.normalizeParticipantName(target.participantName);
        let locatedAttempt = -1;
        for (let attempt = 0; attempt < 16; attempt++) {
          await this.sleep(50);
          const fresh = this.detector.scan();
          const refreshed = fresh.find((s) =>
            s.id === target.id ||
            s.index === target.index ||
            this.detector.normalizeParticipantName(s.participantName) === targetNorm
          );
          if (refreshed?.tileElement && document.body?.contains(refreshed.tileElement)) {
            currentTile = refreshed.tileElement;
            target = refreshed;
            isInDom = true;
            locatedAttempt = attempt + 1;
            break;
          }
        }

        if (isInDom) {
          this.logger.log('ACTION', `Off-screen tile located after ${locatedAttempt * 50}ms grid expansion`, {
            participantName: target.participantName,
            attempt: locatedAttempt,
          });
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
      let pinBtn = MeetSelectors.findPinButton(currentTile);

      if (!pinBtn) {
        for (let i = 0; i < 6; i++) {
          await this.sleep(40);
          this.hoverTile(currentTile);
          pinBtn = MeetSelectors.findPinButton(currentTile);
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
        const elapsedMs = Date.now() - switchStartTime;
        this.logger.recordSwitch(target.participantName, target.index, true);
        this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" in ${elapsedMs}ms`);

        // Clean up any previously pinned screens (if multi-pin kept them)
        const allShares = this.detector.getScreenShares();
        for (const share of allShares) {
          if (share.id !== target.id && share.isPinned && share.tileElement) {
            this.hoverTile(share.tileElement);
            await this.sleep(40);
            const otherUnpin = MeetSelectors.findUnpinButton(share.tileElement);
            if (otherUnpin) {
              this.dispatchFullClick(otherUnpin);
            }
          }
        }

        setTimeout(() => this.detector.scan(), 50);
        return true;
      }

      // FALLBACK PATH 1: Try People side panel pinning if direct pin button was not found on tile
      const panelPinned = await this.pinViaPeoplePanel(target.participantName);
      if (panelPinned) {
        const elapsedMs = Date.now() - switchStartTime;
        this.logger.recordSwitch(target.participantName, target.index, true);
        this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" via People panel fallback in ${elapsedMs}ms`);
        setTimeout(() => this.detector.scan(), 100);
        return true;
      }

      // FALLBACK PATH 2: Unpin active streams and retry
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
        pinBtn = MeetSelectors.findPinButton(retryTile);

        if (pinBtn) {
          this.logger.log('ACTION', `Dispatched retry Pin click on tile for "${target.participantName}"`);
          this.dispatchFullClick(pinBtn);
          await this.handlePinMenuIfOpened();
          const elapsedMs = Date.now() - switchStartTime;
          this.logger.recordSwitch(target.participantName, target.index, true);
          this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" via fallback path in ${elapsedMs}ms`);
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
        await this.sleep(40);
        const unpinBtn = MeetSelectors.findUnpinButton(share.tileElement);
        if (unpinBtn) {
          this.dispatchFullClick(unpinBtn);
          unpinned = true;
        }
      }
    }

    // 2. Fallback: Search globally for any active unpin button on the main stage
    if (!unpinned) {
      const globalButtons = MeetSelectors.findGlobalUnpinButtons(document);
      for (const btn of globalButtons) {
        if (btn.offsetParent === null && btn.clientWidth === 0) continue;
        this.dispatchFullClick(btn);
      }
    }

    this.detector.markAllUnpinned();
  }

  /**
   * Checks if Google Meet's "People" ("Учасники") side panel is currently open.
   */
  public isPeoplePanelOpen(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): boolean {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelector) return false;

    const peopleBtn = MeetSelectors.findPeoplePanelBtn(targetDoc);
    if (peopleBtn) {
      const isPressed = peopleBtn.getAttribute('aria-pressed') === 'true';
      const hasClass = Boolean(peopleBtn.classList?.contains && peopleBtn.classList.contains('qs41qe'));
      if (isPressed || hasClass) {
        return true;
      }
      // If button exists but is not pressed, it means panel is closed
      return false;
    }

    const panel = MeetSelectors.findPeoplePanel(targetDoc);
    return Boolean(panel);
  }

  /**
   * Ensures Google Meet's People side panel is open.
   */
  public async openPeoplePanel(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): Promise<boolean> {
    if (this.isPeoplePanelOpen(doc)) return true;
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelector) return false;

    const peopleBtn = MeetSelectors.findPeoplePanelBtn(targetDoc);
    if (!peopleBtn) {
      this.logger.log('WARN', 'Could not locate People button to open side panel');
      return false;
    }

    this.logger.log('ACTION', 'Opening People side panel to locate off-screen presentation');
    this.dispatchFullClick(peopleBtn);

    for (let i = 0; i < 8; i++) {
      await this.sleep(50);
      if (this.isPeoplePanelOpen(doc)) {
        return true;
      }
    }
    return this.isPeoplePanelOpen(doc);
  }

  /**
   * Finds the presentation list item corresponding to participantName in the People panel.
   */
  public findPresentationItemInPeoplePanel(participantName: string, doc: Document = (typeof document !== 'undefined' ? document : ({} as any)), requirePresentation = true): HTMLElement | null {
    const normTarget = this.detector.normalizeParticipantName(participantName);
    const isTeacherSelf = normTarget.includes('ваш екран') || normTarget.includes('your screen') || normTarget.includes('ви') || normTarget.includes('you');
    if (!normTarget) return null;

    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return null;

    // Search inside People/In call container, Side panel aside, or whole document
    // NOTE: Avoid bare 'div[role="tabpanel"]' as it matches the Activities/Add-ons panel!
    const panel: any =
      MeetSelectors.findPeoplePanel(targetDoc) ||
      (targetDoc as any).body ||
      targetDoc;

    if (!panel || typeof panel.querySelectorAll !== 'function') return null;

    const presentationRegex = MEET_DICTIONARY.PRESENTATION.PRESENTATION_KEYWORD;

    // Pass 1: Direct presentation action buttons (e.g. "Mute Bohdan Rubakha's presentation")
    const allButtons: HTMLElement[] = Array.from(panel.querySelectorAll('button, [role="button"]'));
    for (const btn of allButtons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        (aria.includes(normTarget) || aria.includes(participantName.toLowerCase()) || (isTeacherSelf && (aria.includes('you') || aria.includes('ви') || aria.includes('вы')))) &&
        (!requirePresentation || presentationRegex.test(aria))
      ) {
        const row =
          (typeof btn.closest === 'function' &&
            btn.closest('div[role="listitem"], [role="row"], div[data-participant-id]')) ||
          btn.parentElement?.parentElement ||
          btn.parentElement;
        if (row) return row as HTMLElement;
      }
    }

    // Pass 2: List items matching participant name and presentation keyword
    const items: HTMLElement[] = Array.from(
      panel.querySelectorAll(
        'div[role="listitem"], li[role="listitem"], div[data-participant-id], div[data-requested-participant-id]'
      )
    ) as HTMLElement[];

    for (const item of items) {
      const text = item.textContent || '';
      const aria = item.getAttribute('aria-label') || '';
      const combined = `${text} ${aria}`.toLowerCase();
      const normCombined = this.detector.normalizeParticipantName(combined);

      if (normCombined.includes(normTarget) || combined.includes(participantName.toLowerCase()) || (isTeacherSelf && (combined.includes('you') || combined.includes('ви') || combined.includes('вы')))) {
        if (!requirePresentation) {
          return item;
        }

        if (presentationRegex.test(combined)) {
          return item;
        }

        const presChild = item.querySelector && item.querySelector(
          'i, span, [aria-label*="presentation" i], [aria-label*="презентац" i]'
        );
        if (presChild) {
          const childText = (presChild.textContent || '').toLowerCase();
          const childAria = (presChild.getAttribute('aria-label') || '').toLowerCase();
          if (presentationRegex.test(childText) || presentationRegex.test(childAria)) {
            return item;
          }
        }
      }
    }

    return null;
  }

  /**
   * Finds the Pin button inside a People panel presentation row (if directly visible).
   */
  public findPinButtonInItem(item: HTMLElement): HTMLElement | null {
    if (!item.querySelectorAll) return null;
    const buttons = Array.from(item.querySelectorAll<HTMLElement>('button, [role="button"], div[tabindex="0"]'));
    const pinRegex = /(?:pin|закріпити|прикріпити|keep)/i;

    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      const isUnpin = aria.includes('unpin') || aria.includes('відкріпити') || aria.includes('открепить') || tooltip.includes('unpin');
      if (isUnpin) continue;

      if (
        pinRegex.test(aria) ||
        pinRegex.test(tooltip) ||
        text.includes('keep') ||
        aria.includes('keep_outline') ||
        text.includes('keep_outline')
      ) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Pins a participant's presentation reliably using Google Meet's People side panel.
   */
  public async pinViaPeoplePanel(participantName: string, doc: Document = (typeof document !== 'undefined' ? document : ({} as any)), requirePresentation = true): Promise<boolean> {
    const isOpen = await this.openPeoplePanel(doc);
    if (!isOpen) {
      this.logger.log('WARN', `Failed to open People panel for pinning "${participantName}"`);
      return false;
    }

    // Poll up to 400ms for the presentation row to appear
    let item: HTMLElement | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      item = this.findPresentationItemInPeoplePanel(participantName, doc, requirePresentation);
      if (item) break;
      await this.sleep(50);
    }

    // Graceful Fallback: If we couldn't find an explicit presentation row,
    // fallback to pinning their generic camera row.
    if (!item && requirePresentation) {
      this.logger.log('WARN', `Could not find explicit presentation item in People panel for "${participantName}". Falling back to generic participant row.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        item = this.findPresentationItemInPeoplePanel(participantName, doc, false);
        if (item) break;
        await this.sleep(50);
      }
    }

    if (!item) {
      this.logger.log('WARN', `Could not find any participant item in People panel for "${participantName}"`);
      return false;
    }

    this.hoverTile(item);
    await this.sleep(30);

    // 1. If direct pin button is visible, click it
    let pinBtn = this.findPinButtonInItem(item);
    if (!pinBtn) {
      for (let i = 0; i < 3; i++) {
        await this.sleep(30);
        this.hoverTile(item);
        pinBtn = this.findPinButtonInItem(item);
        if (pinBtn) break;
      }
    }

    if (pinBtn) {
      this.logger.log('ACTION', `Dispatched direct Pin click in People panel for "${participantName}"`);
      this.dispatchFullClick(pinBtn);
      await this.handlePinMenuIfOpened(doc);
      this.detector.setExpectedPinnedParticipant(participantName);
      return true;
    }

    // 2. Click "More actions" (3-dots) on the presentation row and select "Pin to screen"
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    const rowButtons = Array.from(item.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const moreBtn =
      rowButtons.find((b) => {
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').trim();
        return (
          MEET_DICTIONARY.MORE_ACTIONS.test(aria) ||
          MEET_DICTIONARY.MORE_ACTIONS.test(text) ||
          text === MEET_DICTIONARY.ICONS.MORE_VERT ||
          aria.includes(MEET_DICTIONARY.ICONS.MORE_VERT)
        );
      }) ||
      (item.querySelector && Array.from(item.querySelectorAll<HTMLElement>('button, [role="button"]')).find(b => MEET_DICTIONARY.MORE_ACTIONS.test((b.getAttribute('aria-label') || '').toLowerCase())));

    if (moreBtn && targetDoc?.querySelectorAll) {
      this.dispatchFullClick(moreBtn);
      await this.sleep(80);

      const menuItems = Array.from(
        targetDoc.querySelectorAll<HTMLElement>(
          '[role="menuitem"], [role="option"], li[role="menuitem"], div[role="menuitem"]'
        )
      );
      const menuPin = menuItems.find((m) => {
        const t = (m.textContent || '').toLowerCase();
        const a = (m.getAttribute('aria-label') || '').toLowerCase();
        return (
          (t.includes('pin') || t.includes('закріп') || a.includes('pin') || a.includes('закріп') || t.includes('keep')) &&
          !t.includes('unpin') &&
          !a.includes('unpin') &&
          !t.includes('відкріпити') &&
          !t.includes('открепить')
        );
      });

      if (menuPin) {
        this.logger.log('ACTION', `Selected Pin option in More actions menu for "${participantName}"`);
        this.dispatchFullClick(menuPin);
        await this.handlePinMenuIfOpened(doc);
        this.detector.setExpectedPinnedParticipant(participantName);
        return true;
      }
    }

    this.logger.log('WARN', `Pin button and More actions menu not found inside People panel item for "${participantName}"`);
    return false;
  }

  /**
   * Dispatches realistic Pointer & Mouse events with real center coordinates.
   * Google Meet's internal JSAction requires real event sequences to execute clicks.
   */
  private dispatchFullClick(element: HTMLElement): void {
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
  private async handlePinMenuIfOpened(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): Promise<boolean> {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelectorAll) return false;

    for (let i = 0; i < 5; i++) {
      await this.sleep(40);

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

        // STRICT CHECK: The menu MUST contain at least one option matching forMyselfRegex or forEveryoneRegex.
        // Otherwise, it is an unrelated menu (e.g. 3-dots actions menu) and must NOT be clicked!
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

        // 2. Safe fallback ONLY if the menu had an explicit "for everyone" option:
        // pick the option that does NOT contain "everyone"
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
            this.dispatchFullClick(safeItems[0]);
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Hover over a tile element with real coordinates to trigger Meet's action buttons.
   */
  private hoverTile(element: HTMLElement): void {
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
