import type { ScreenShare, ScreenSharesListener } from '../types/index.ts';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import { MeetSelectors } from './ui/selectors.ts';
import { TileParser } from './tile-parser.ts';
import { ShareRegistry } from './share-registry.ts';
import type { RawTile } from './share-registry.ts';
import type { TileParserContext } from './tile-parser.ts';

// Re-export for backwards compatibility with external consumers
export { SYSTEM_NAME_PATTERNS } from './tile-parser.ts';

/**
 * Orchestrates Google Meet DOM observation, screen-share detection, and pin state.
 *
 * Delegates:
 *  - DOM tile analysis  → TileParser
 *  - Share state/slots  → ShareRegistry
 * Owns:
 *  - MutationObserver lifecycle
 *  - Pin state (expectedPinnedParticipant, unpinnedUntil)
 *  - EventBus (onUpdate, onScan listeners)
 *  - scan() orchestration
 */
export class ScreenDetector {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private currentShares: ScreenShare[] = [];
  private isScanning = false;
  private hasInitialized = false;
  private expectedPinnedParticipant: string | null = null;
  private unpinnedUntil = 0;
  private listeners: Set<ScreenSharesListener> = new Set();
  private scanListeners: Set<ScreenSharesListener> = new Set();
  private logger = DiagnosticsLogger.getInstance();

  private parser = new TileParser();
  private registry = new ShareRegistry(this.parser, this.logger);

  // ---------------------------------------------------------------------------
  // EventBus
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to detected screen shares updates.
   * The listener is called immediately with the current state.
   */
  public onUpdate(listener: ScreenSharesListener): () => void {
    this.listeners.add(listener);
    listener(this.currentShares);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to every DOM scan event (even when the shares list did not change).
   * Useful for decorators that need to maintain injected DOM elements across Meet re-renders.
   */
  public onScan(listener: ScreenSharesListener): () => void {
    this.scanListeners.add(listener);
    return () => this.scanListeners.delete(listener);
  }

  /** Return the latest scanned screen shares. */
  public getScreenShares(): ScreenShare[] {
    return this.currentShares;
  }

  // ---------------------------------------------------------------------------
  // Pin state management
  // ---------------------------------------------------------------------------

  /** Notify detector of the participant about to be pinned. */
  public setExpectedPinnedParticipant(name: string | null): void {
    this.expectedPinnedParticipant = name;
    if (name) this.unpinnedUntil = 0;
  }

  public getExpectedPinnedParticipant(): string | null {
    return this.expectedPinnedParticipant;
  }

  /**
   * Tries to find the currently pinned participant name from the global UI,
   * in case they were pinned manually by the user.
   */
  public getGlobalPinnedParticipantName(): string | null {
    if (this.expectedPinnedParticipant) return this.expectedPinnedParticipant;

    const unpinBtns = MeetSelectors.findGlobalUnpinButtons(document);
    const activeBtn = unpinBtns.find((btn) => btn.offsetParent !== null || btn.clientWidth > 0);
    if (!activeBtn) return null;

    const label = activeBtn.getAttribute('aria-label') || activeBtn.getAttribute('data-tooltip') || '';
    const match = label.match(
      /(?:Відкріпити|Unpin|Открепить)\s+(?:презентацію\s+(?:користувача\s+)?)?(.+?)(?:\s+на головному екрані|\s+на екрані|\s*\(презентація\)|\s+презентацію|\s+презентацию|'s presentation|$)/i,
    );
    if (match?.[1]) {
      const cleaned = this.parser.cleanParticipantName(match[1]);
      if (this.parser.isValidParticipantName(cleaned)) return cleaned;
    }

    return null;
  }

  /**
   * Clear pinned state across all known shares (e.g. after global unpin)
   * and immediately notify UI to remove active highlights.
   */
  public markAllUnpinned(): void {
    this.expectedPinnedParticipant = null;
    this.unpinnedUntil = Date.now() + 600;
    this.registry.markAllUnpinned();
    for (const share of this.currentShares) {
      share.isPinned = false;
    }
    this.notifyListeners();
  }

  /** Clear any unpin suppression timeout when a new share is intentionally pinned. */
  public clearUnpinnedSuppress(): void {
    this.unpinnedUntil = 0;
  }

  /**
   * Check if any stream is currently pinned or displayed on the main stage.
   * Resilient to Google Meet control fadeout by checking stage geometry, zoom buttons, and ink canvas.
   */
  public isAnyStreamPinned(): boolean {
    if (Date.now() < this.unpinnedUntil) return false;
    if (this.expectedPinnedParticipant) return true;
    if (this.currentShares.some((s) => s.isPinned)) return true;
    for (const share of this.registry.shares.values()) {
      if (share.isPinned) return true;
    }

    const unpinBtns = MeetSelectors.findGlobalUnpinButtons(document);
    if (unpinBtns.some((btn) => btn.offsetParent !== null || btn.clientWidth > 0)) return true;

    const stageElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        'button[aria-label*="zoom" i], button[data-tooltip*="zoom" i], .ink-canvas-parent, .ink-layer-container',
      ),
    );
    if (stageElements.some((el) => el.offsetParent !== null || el.clientWidth > 0)) return true;

    try {
      if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        for (const video of videos) {
          const tile = this.parser.findTileContainer(video);
          if (tile) {
            const rect = tile.getBoundingClientRect();
            if (rect.width > window.innerWidth * 0.45 && rect.height > window.innerHeight * 0.45) {
              return true;
            }
          }
        }
      }
    } catch {
      // Ignore geometry errors in non-browser environments
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Observer lifecycle
  // ---------------------------------------------------------------------------

  /** Start observing the Meet DOM. */
  public start(): void {
    if (this.observer) return;
    this.scan();
    this.observer = new MutationObserver(() => {
      if (this.debounceTimer) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = window.setTimeout(() => this.scan(), 150);
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-participant-id', 'aria-label', 'class', 'style'],
    });
  }

  /** Stop observing. */
  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.listeners.clear();
    this.scanListeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Core scan — orchestrates TileParser and ShareRegistry
  // ---------------------------------------------------------------------------

  /** Scan Google Meet video elements and construct ScreenShare items. */
  public scan(): ScreenShare[] {
    if (this.isScanning) return this.currentShares;
    this.isScanning = true;

    try {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
        return this.currentShares;
      }

      const ctx = this.buildContext();
      const rawList = this.collectRawTiles(ctx);
      const consolidated = this.registry.consolidate(rawList);
      const isAnyPinned = consolidated.some((r) => r.isPinned) || this.isAnyStreamPinned();
      const detected = this.registry.update(consolidated, isAnyPinned, this.unpinnedUntil, Date.now());

      const changed = !this.hasInitialized || this.hasSharesChanged(detected);
      this.hasInitialized = true;
      this.currentShares = detected;

      if (changed) {
        this.logger.log('SCAN', `Active presentations updated (${detected.length} shares)`, {
          shares: detected.map((s) => ({
            index: s.index,
            name: s.participantName,
            isPinned: s.isPinned,
            inDom: s.isAvailableInDom,
          })),
          isAnyPinned,
        });
        this.notifyListeners();
      }

      for (const listener of this.scanListeners) {
        try {
          listener(detected);
        } catch (err) {
          console.error('[MeetSwitcher] Error in detector scanListener:', err);
        }
      }

      this.logger.log('SCAN', 'DOM scanned', { videoCount: document.querySelectorAll('video').length });
      return detected;
    } catch (err) {
      this.logger.log('ERROR', 'Unexpected error during DOM scan', { error: String(err) });
      console.error('[MeetSwitcher] Unexpected error during DOM scan:', err);
      return this.currentShares;
    } finally {
      this.isScanning = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Build the context snapshot consumed by TileParser. */
  private buildContext(): TileParserContext {
    return {
      knownShares: this.registry.shares,
      knownPresentationVideos: this.registry.knownPresentationVideos,
      expectedPinnedParticipant: this.expectedPinnedParticipant,
      unpinnedUntil: this.unpinnedUntil,
    };
  }

  /** Walk all video elements and produce a raw tile list. */
  private collectRawTiles(ctx: TileParserContext): RawTile[] {
    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    const rawList: RawTile[] = [];
    const seenTileIds = new Set<string>();

    for (const video of videos) {
      const tile = this.parser.findTileContainer(video);
      if (!tile) continue;
      if (this.parser.isMediaStreamEnded(video)) continue;
      if (!this.parser.isPresentationTile(tile, video, ctx)) continue;

      const participantName = this.parser.extractParticipantName(tile, ctx);
      if (!this.parser.isValidParticipantName(participantName)) continue;

      const participantId =
        tile.getAttribute('data-participant-id') ||
        tile.getAttribute('data-requested-participant-id') ||
        tile.getAttribute('data-tile-media-id') ||
        '';

      const tileId = participantId
        ? `${participantId}:pres`
        : `pres-${participantName.toLowerCase().replace(/\s+/g, '-')}`;

      if (seenTileIds.has(tileId)) continue;
      seenTileIds.add(tileId);

      this.logger.recordParticipantFound(participantName);

      rawList.push({
        id: tileId,
        participantName,
        isPinned: this.parser.isTilePinned(tile, this.unpinnedUntil),
        tileElement: tile,
        videoElement: video,
        pinButton: MeetSelectors.findPinButton(tile),
        unpinButton: MeetSelectors.findUnpinButton(tile),
      });
    }

    return rawList;
  }

  private hasSharesChanged(next: ScreenShare[]): boolean {
    if (this.currentShares.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
      const a = this.currentShares[i];
      const b = next[i];
      if (a.id !== b.id || a.isPinned !== b.isPinned || a.index !== b.index || a.participantName !== b.participantName) {
        return true;
      }
    }
    return false;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentShares);
      } catch (err) {
        console.error('[MeetSwitcher] Error in detector listener:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Proxy methods — preserve existing public API consumed by tests and other modules
  // ---------------------------------------------------------------------------

  public normalizeParticipantName(name: string): string {
    return this.parser.normalizeParticipantName(name);
  }

  public isValidParticipantName(name: string): boolean {
    return this.parser.isValidParticipantName(name);
  }

  public cleanParticipantName(raw: string): string {
    return this.parser.cleanParticipantName(raw);
  }

  public isGenericFallbackName(name: string): boolean {
    return this.parser.isGenericFallbackName(name);
  }

  public isTeacherScreenName(name: string): boolean {
    return this.parser.isTeacherScreenName(name);
  }

  public isMediaStreamEnded(video: HTMLVideoElement | null | undefined): boolean {
    return this.parser.isMediaStreamEnded(video);
  }

  public isTilePinned(tile: HTMLElement): boolean {
    return this.parser.isTilePinned(tile, this.unpinnedUntil);
  }

  public isPresentationTile(tile: HTMLElement, videoElement?: HTMLVideoElement): boolean {
    return this.parser.isPresentationTile(tile, videoElement, this.buildContext());
  }

  public extractParticipantName(tile: HTMLElement): string {
    return this.parser.extractParticipantName(tile, this.buildContext());
  }

  /**
   * Proxy to the registry's mutable share map.
   * Allows tests to seed data via `(detector as any).knownShares.set(...)`.
   */
  get knownShares(): Map<string, ScreenShare> {
    return this.registry.mutableShares;
  }
}
