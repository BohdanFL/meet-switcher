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

  /**
   * Automatically switches to the most relevant presentation.
   */
  public async autoSwitch(): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    if (shares.length === 0) return false;

    if (shares.some((s) => s.isPinned)) return true;

    return this.switchToShare(shares[0]);
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
      await this.grid.unpinAll(this.detector.getScreenShares());
      this.detector.markAllUnpinned();
      setTimeout(() => this.detector.scan(), 150);
      setTimeout(() => this.detector.scan(), 550);
      return true;
    } finally {
      this.isSwitching = false;
    }
  }

  /**
   * Check if any stream is currently pinned.
   */
  private hasPinnedStream(): boolean {
    return this.detector.getScreenShares().some((s) => s.isPinned);
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
        await this.grid.unpinAll(this.detector.getScreenShares());
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

        const pinnedViaPanel = await this.sidePanel.pinParticipant(target.participantName);
        if (pinnedViaPanel) {
          const elapsedMs = Date.now() - switchStartTime;
          this.logger.recordSwitch(target.participantName, target.index, true);
          this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" via People panel in ${elapsedMs}ms`);

          // Clean up any previously pinned screens (if multi-pin kept them)
          const allShares = this.detector.getScreenShares();
          for (const share of allShares) {
            if (share.id !== target.id && share.isPinned && share.tileElement && document.body?.contains(share.tileElement)) {
              await this.grid.unpinTile(share.tileElement);
            }
          }

          setTimeout(() => this.detector.scan(), 100);
          return true;
        }

        console.log(
          `[MeetSwitcher] People panel pinning unavailable or failed for "${target.participantName}". Expanding Meet grid...`
        );
        this.logger.log('ACTION', `People panel pinning failed, expanding grid for "${target.participantName}"`);
        await this.grid.unpinAll(this.detector.getScreenShares());
        this.detector.markAllUnpinned();

        // Google Meet needs 200-400ms to reflow and mount all tiles into the DOM.
        // Poll with retries for up to 800ms (16 attempts * 50ms)
        const targetNorm = this.detector.normalizeParticipantName(target.participantName);
        let locatedAttempt = -1;
        for (let attempt = 0; attempt < 16; attempt++) {
          await sleep(50);
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
      await this.grid.ensureTileVisible(currentTile);

      // 2. Pin Tile using Grid UI
      const pinned = await this.grid.pinTile(currentTile, target.participantName);

      if (pinned) {
        const elapsedMs = Date.now() - switchStartTime;
        this.logger.recordSwitch(target.participantName, target.index, true);
        this.logger.log('ACTION', `Successfully switched to [${target.index}] "${target.participantName}" in ${elapsedMs}ms`);

        // Clean up any previously pinned screens (if multi-pin kept them)
        const allShares = this.detector.getScreenShares();
        for (const share of allShares) {
          if (share.id !== target.id && share.isPinned && share.tileElement) {
            await this.grid.unpinTile(share.tileElement);
          }
        }

        setTimeout(() => this.detector.scan(), 100);
        return true;
      }

      this.logger.recordSwitch(target.participantName, target.index, false, 'Pin button missing');
      this.logger.log('ERROR', 'Pin button missing on tile');
      return false;
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

  // --- Methods retained for backwards compatibility with tests / API ---
  
  public getDetector(): ScreenDetector {
    return this.detector;
  }

  public async unpinActiveStreams(): Promise<boolean> {
    return this.grid.unpinAll(this.detector.getScreenShares());
  }

  public async switchToIndex(index: number): Promise<boolean> {
    const shares = this.detector.getScreenShares();
    const target = shares.find(s => s.index === index);
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
