import { ScreenDetector } from './detector.ts';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import type { ScreenShare } from '../types/index.ts';
import { MeetSidePanelUI } from './ui/side-panel-ui.ts';
import { MeetGridUI } from './ui/grid-ui.ts';
import { sleep } from './ui/dom-utils.ts';

/**
 * Controller responsible for switching and managing pins using the Meet UI.
 * Acts as an orchestrator that delegates DOM interaction to specific UI classes.
 */
export class PinController {
  private detector: ScreenDetector;
  private isSwitching = false;
  private logger: DiagnosticsLogger;

  private sidePanel: MeetSidePanelUI;
  private grid: MeetGridUI;

  constructor(detector: ScreenDetector, logger?: DiagnosticsLogger) {
    this.detector = detector;
    this.logger = logger || DiagnosticsLogger.getInstance();

    this.sidePanel = new MeetSidePanelUI(this.logger, this.detector);
    this.grid = new MeetGridUI(this.logger);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Automatically switches to the most relevant presentation. */
  public async autoSwitch(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;
    if (shares.some((s) => s.isPinned)) return true;
    return this.switchToShare(shares[0]);
  }

  /** Switch to the next available screen share cyclically. */
  public async switchNext(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;
    const cur = shares.findIndex((s) => s.isPinned);
    return this.switchToShare(shares[cur === -1 ? 0 : (cur + 1) % shares.length]);
  }

  /** Switch to the previous available screen share cyclically. */
  public async switchPrevious(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;
    const cur = shares.findIndex((s) => s.isPinned);
    return this.switchToShare(shares[cur === -1 ? shares.length - 1 : (cur - 1 + shares.length) % shares.length]);
  }

  /** Explicitly unpin any currently pinned stream (returns Meet to standard grid). */
  public async unpin(): Promise<boolean> {
    if (this.isSwitching) {
      this.logger.log('WARN', 'Unpin request ignored: another switch operation is already active');
      return false;
    }
    this.isSwitching = true;
    try {
      await this.grid.unpinAll(this.detector.getScreenShares());
      this.detector.markAllUnpinned();
      this.scheduleScans(150, 550);
      return true;
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Core switching logic.
   * If already pinned → toggle-unpin.
   * If tile in DOM   → pin via grid.
   * If tile off-screen → try side panel, then expand grid and retry.
   */
  public async switchToShare(target: ScreenShare): Promise<boolean> {
    if (this.isSwitching) {
      this.logger.log('WARN', `Switch to [${target.index}] "${target.participantName}" ignored: another switch operation is already active`);
      return false;
    }
    this.isSwitching = true;
    const startTime = Date.now();

    try {
      // 1. Toggle: already pinned → unpin
      if (target.isPinned) {
        return await this.unpinToggle(target);
      }

      this.detector.clearUnpinnedSuppress();

      let tile = target.tileElement;
      let inDom = this.checkTileInDom(tile);

      this.logger.log('ACTION', `Request switch to [${target.index}] "${target.participantName}"`, {
        targetId: target.id,
        isInDom: inDom,
      });

      // 2. Off-screen: try side panel then expand grid
      if (!inDom) {
        const offscreen = await this.handleOffscreen(target, startTime);
        if (offscreen.done) return offscreen.success;
        target = offscreen.target;
        tile = target.tileElement ?? null;
        inDom = this.checkTileInDom(tile);
      }

      // 3. Still not in DOM after all attempts → fail
      if (!tile || !document.body.contains(tile)) {
        return this.failSwitch(target, 'Tile not in DOM');
      }

      // 4. Pin via grid
      return await this.pinFromGrid(tile, target, startTime);

    } catch (err: any) {
      this.logger.recordSwitch(target.participantName, target.index, false, err.message);
      console.error(`[MeetSwitcher] Failed to switch to [${target.index}] ${target.participantName}:`, err);
      this.logger.log('ERROR', `Failed to switch to [${target.index}] ${target.participantName}`, {
        error: err.message,
        stack: err.stack,
      });
      return false;
    } finally {
      this.isSwitching = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers — each has one clear responsibility
  // ---------------------------------------------------------------------------

  /** Handles the already-pinned toggle case. */
  private async unpinToggle(target: ScreenShare): Promise<boolean> {
    console.log(`[MeetSwitcher] "${target.participantName}" is already pinned. Unpinning...`);
    this.logger.log('ACTION', `Unpinned active stream: "${target.participantName}"`);
    await this.grid.unpinAll(this.detector.getScreenShares());
    this.detector.markAllUnpinned();
    this.scheduleScans(150, 550);
    return true;
  }

  /**
   * Handles off-screen tiles.
   * 1. Try to pin via the side panel.
   * 2. If that fails, expand the grid and poll until the tile appears.
   *
   * Returns `{ done: true, success }` when the result is final,
   * or `{ done: false, target }` when the tile was found and grid-pinning should continue.
   */
  private async handleOffscreen(
    target: ScreenShare,
    startTime: number,
  ): Promise<{ done: true; success: boolean } | { done: false; target: ScreenShare }> {
    this.logger.log('ACTION', `Tile off-screen, attempting People panel pinning for "${target.participantName}"`);

    // Path A: side panel
    const pinnedViaPanel = await this.sidePanel.pinParticipant(target.participantName);
    if (pinnedViaPanel) {
      this.logger.recordSwitch(target.participantName, target.index, true);
      this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" via People panel in ${Date.now() - startTime}ms`);
      await this.cleanupOtherPins(target.id);
      this.scheduleScans(100);
      return { done: true, success: true };
    }

    // Path B: expand grid and poll for tile
    console.log(`[MeetSwitcher] People panel pinning unavailable or failed for "${target.participantName}". Expanding Meet grid...`);
    this.logger.log('ACTION', `People panel pinning failed, expanding grid for "${target.participantName}"`);
    await this.grid.unpinAll(this.detector.getScreenShares());
    this.detector.markAllUnpinned();

    const refreshed = await this.pollForTile(target);
    return { done: false, target: refreshed ?? target };
  }

  /**
   * Polls the detector after a grid-expand unpin, waiting for the target tile
   * to appear in the DOM. Returns the refreshed ScreenShare or null.
   */
  private async pollForTile(target: ScreenShare): Promise<ScreenShare | null> {
    const normTarget = this.detector.normalizeParticipantName(target.participantName);

    for (let attempt = 0; attempt < 16; attempt++) {
      await sleep(50);
      const fresh = this.detector.scan();
      const found = fresh.find(
        (s) =>
          s.id === target.id ||
          s.index === target.index ||
          this.detector.normalizeParticipantName(s.participantName) === normTarget,
      );
      if (found?.tileElement && document.body?.contains(found.tileElement)) {
        this.logger.log('ACTION', `Off-screen tile located after ${(attempt + 1) * 50}ms grid expansion`, {
          participantName: found.participantName,
          attempt: attempt + 1,
        });
        return found;
      }
    }
    return null;
  }

  /**
   * Pins a tile that is confirmed to be in the DOM.
   * Handles geometry, hover, click, host menu, and cleanup of other pins.
   */
  private async pinFromGrid(tile: HTMLElement, target: ScreenShare, startTime: number): Promise<boolean> {
    this.detector.setExpectedPinnedParticipant(target.participantName);
    await this.grid.ensureTileVisible(tile);

    const pinned = await this.grid.pinTile(tile, target.participantName);

    if (pinned) {
      this.logger.recordSwitch(target.participantName, target.index, true);
      this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" in ${Date.now() - startTime}ms`);
      await this.cleanupOtherPins(target.id);
      this.scheduleScans(100);
      return true;
    }

    this.logger.recordSwitch(target.participantName, target.index, false, 'Pin button missing');
    this.logger.log('ERROR', 'Pin button missing on tile');
    return false;
  }

  /** Unpins all other currently-pinned shares (cleanup after a successful pin). */
  private async cleanupOtherPins(targetId: string): Promise<void> {
    const allShares = this.detector.getScreenShares();
    for (const share of allShares) {
      if (share.id !== targetId && share.isPinned && share.tileElement && document.body?.contains(share.tileElement)) {
        await this.grid.unpinTile(share.tileElement);
      }
    }
  }

  /** Schedules one or more detector scans at the given delay(s). */
  private scheduleScans(...delaysMs: number[]): void {
    for (const ms of delaysMs) {
      setTimeout(() => this.detector.scan(), ms);
    }
  }

  /** Returns true when a tile element is visible and contained in the DOM. */
  private checkTileInDom(tile: HTMLElement | null | undefined): boolean {
    return Boolean(tile && document.body.contains(tile) && tile.getBoundingClientRect().width > 0);
  }

  /** Logs a failed switch and returns false. */
  private failSwitch(target: ScreenShare, reason: string): boolean {
    const snap = this.logger.captureDomSnapshot(this.hasPinnedStream());
    this.logger.recordSwitch(target.participantName, target.index, false, reason);
    this.logger.log('ERROR', `Could not locate tile for "${target.participantName}"`, { targetId: target.id }, snap);
    console.warn(`[MeetSwitcher] Could not locate tile for "${target.participantName}"`);
    return false;
  }

  private hasPinnedStream(): boolean {
    return this.detector.getScreenShares().some((s) => s.isPinned);
  }

  // ---------------------------------------------------------------------------
  // Backwards-compatible API used by tests and hud.ts
  // ---------------------------------------------------------------------------

  public getDetector(): ScreenDetector {
    return this.detector;
  }

  public async unpinActiveStreams(): Promise<boolean> {
    return this.grid.unpinAll(this.detector.getScreenShares());
  }

  public async switchToIndex(index: number): Promise<boolean> {
    const target = this.detector.getScreenShares().find((s) => s.index === index);
    if (!target) return false;
    return this.switchToShare(target);
  }

  public isPeoplePanelOpen(doc?: Document): boolean {
    return this.sidePanel.isPeoplePanelOpen(doc);
  }

  public async handlePinMenuIfOpened(doc?: Document): Promise<boolean> {
    return this.grid.handlePinMenuIfOpened(doc);
  }

  public async openPeoplePanel(doc?: Document): Promise<boolean> {
    return this.sidePanel.open(doc);
  }

  public findPresentationItemInPeoplePanel(participantName: string, doc?: Document, requirePresentation = true): HTMLElement | null {
    return this.sidePanel.findPresentationItemInPeoplePanel(participantName, doc, requirePresentation);
  }

  public async pinViaPeoplePanel(participantName: string, doc?: Document, requirePresentation = true): Promise<boolean> {
    return this.sidePanel.pinParticipant(participantName, doc, requirePresentation);
  }
}
