import { ScreenShare, ScreenSharesListener } from '../types';

/**
 * Known icon names used by Google Meet to filter out of participant name detection.
 */
const SYSTEM_ICON_STRINGS = new Set([
  'keep_outline',
  'keep_off',
  'volume_off',
  'volume_up',
  'mic_off',
  'mic',
  'more_vert',
  'frame_person',
  'visual_effects',
  'fullscreen',
  'fullscreen_exit',
  'open_in_new',
  'zoom_in',
  'zoom_out',
]);

export class ScreenDetector {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private currentShares: ScreenShare[] = [];
  private listeners: Set<ScreenSharesListener> = new Set();
  private isScanning = false;
  private hasInitialized = false;
  private participantSlots: Map<string, number> = new Map();

  /**
   * Subscribe to detected screen shares updates.
   */
  public onUpdate(listener: ScreenSharesListener): () => void {
    this.listeners.add(listener);
    // Emit current state immediately
    listener(this.currentShares);
    return () => this.listeners.delete(listener);
  }

  /**
   * Return the latest scanned screen shares.
   */
  public getScreenShares(): ScreenShare[] {
    return this.currentShares;
  }

  /**
   * Start observing the Meet DOM.
   */
  public start(): void {
    if (this.observer) return;

    // Run initial scan
    this.scan();

    this.observer = new MutationObserver(() => {
      if (this.debounceTimer) {
        window.clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = window.setTimeout(() => {
        this.scan();
      }, 150);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-participant-id', 'aria-label', 'class', 'style'],
    });
  }

  /**
   * Stop observing.
   */
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
  }

  /**
   * Scan Google Meet video elements and construct ScreenShare items.
   */
  public scan(): ScreenShare[] {
    if (this.isScanning) return this.currentShares;
    this.isScanning = true;

    try {
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
      interface RawTile {
        id: string;
        participantName: string;
        isPinned: boolean;
        tileElement: HTMLElement;
        videoElement: HTMLVideoElement;
        pinButton: HTMLButtonElement | null;
        unpinButton: HTMLButtonElement | null;
      }
      const rawList: RawTile[] = [];
      const seenTileIds = new Set<string>();

      for (const video of videos) {
        const tile = this.findTileContainer(video);
        if (!tile) continue;

        const tileId =
          tile.getAttribute('data-participant-id') ||
          tile.getAttribute('data-requested-participant-id') ||
          tile.getAttribute('data-tile-media-id') ||
          `tile-${rawList.length}`;

        // Avoid duplicate entries for the same tile
        if (seenTileIds.has(tileId)) continue;

        if (this.isPresentationTile(tile)) {
          seenTileIds.add(tileId);

          const isPinned = this.isTilePinned(tile);
          const participantName = this.extractParticipantName(tile);
          const pinButton = this.findPinButton(tile);
          const unpinButton = this.findUnpinButton(tile);

          rawList.push({
            id: tileId,
            participantName,
            isPinned,
            tileElement: tile,
            videoElement: video,
            pinButton,
            unpinButton,
          });
        }
      }

      // Clean up slots for participants that left
      const activeIds = new Set(rawList.map((r) => r.id));
      for (const id of this.participantSlots.keys()) {
        if (!activeIds.has(id)) {
          this.participantSlots.delete(id);
        }
      }

      // Assign stable slot indices (preserving slots across re-orderings and pin actions)
      const usedSlots = new Set(this.participantSlots.values());
      const getNextFreeSlot = (): number => {
        let slot = 1;
        while (usedSlots.has(slot)) {
          slot++;
        }
        usedSlots.add(slot);
        return slot;
      };

      for (const raw of rawList) {
        if (!this.participantSlots.has(raw.id)) {
          this.participantSlots.set(raw.id, getNextFreeSlot());
        }
      }

      // Build detected shares with their fixed slot index
      const detected: ScreenShare[] = rawList.map((raw) => ({
        ...raw,
        index: this.participantSlots.get(raw.id)!,
      }));

      // Sort by index so list order never jumps when a participant is pinned/unpinned
      detected.sort((a, b) => a.index - b.index);

      const changed = !this.hasInitialized || this.hasSharesChanged(detected);
      this.hasInitialized = true;
      this.currentShares = detected;

      if (changed) {
        this.notifyListeners();
      }
      return detected;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Determine if the detected screen shares differ from the previous state.
   */
  private hasSharesChanged(next: ScreenShare[]): boolean {
    if (this.currentShares.length !== next.length) return true;
    for (let i = 0; i < next.length; i++) {
      const a = this.currentShares[i];
      const b = next[i];
      if (
        a.id !== b.id ||
        a.isPinned !== b.isPinned ||
        a.index !== b.index ||
        a.participantName !== b.participantName ||
        a.videoElement !== b.videoElement
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the bounding tile container element for a video.
   */
  private findTileContainer(video: HTMLVideoElement): HTMLElement | null {
    return (
      (video.closest(
        '[data-participant-id], [data-requested-participant-id], [data-tile-media-id], div.oZRSLe, div[data-allocation-index]'
      ) as HTMLElement | null) || video.parentElement
    );
  }

  /**
   * Determine whether a tile is a screen share rather than a webcam.
   */
  private isPresentationTile(tile: HTMLElement): boolean {
    const textContent = tile.textContent || '';

    // 1. Icon checks (Google Meet Material Icons)
    if (textContent.includes('keep_outline') || textContent.includes('keep_off')) {
      return true;
    }

    // 2. Button aria-labels check
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

      // Matches: "presentation", "презентація", "презентация"
      if (
        label.includes('presentation') ||
        label.includes('презентац') ||
        tooltip.includes('presentation') ||
        tooltip.includes('презентац')
      ) {
        return true;
      }
    }

    // 3. Tile attribute checks
    const tileAttrs = (
      tile.getAttribute('aria-label') ||
      tile.getAttribute('data-tile-type') ||
      ''
    ).toLowerCase();

    if (tileAttrs.includes('presentation') || tileAttrs.includes('презентац')) {
      return true;
    }

    return false;
  }

  /**
   * Check if a presentation tile is currently pinned to the main stage.
   */
  private isTilePinned(tile: HTMLElement): boolean {
    // 1. Check for keep_off icon string
    const textContent = tile.textContent || '';
    if (textContent.includes('keep_off')) {
      return true;
    }

    // 2. Check for button with unpin label
    const unpinBtn = this.findUnpinButton(tile);
    return unpinBtn !== null;
  }

  /**
   * Extract human-readable participant name from the tile.
   */
  private extractParticipantName(tile: HTMLElement): string {
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));

    // Heuristic 1: "More options for <Name>" or localized equivalent
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || '';
      const matchMore = label.match(
        /(?:More options for|Більше параметрів для|Другие параметры для)\s+(.+)/i
      );
      if (matchMore && matchMore[1]) {
        return matchMore[1].trim();
      }
    }

    // Heuristic 2: "Unpin / Pin <Name>'s presentation"
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || '';
      if (/your presentation/i.test(label) || /вашу презентацію/i.test(label)) {
        return 'Ваш екран (You)';
      }
      const matchPin = label.match(
        /(?:Pin|Unpin|Закріпити|Відкріпити)\s+(.+?)(?:'s presentation| презентацію| презентацию)/i
      );
      if (matchPin && matchPin[1]) {
        return matchPin[1].trim();
      }
    }

    // Heuristic 3: Inspect text elements within the tile
    const textElements = Array.from(tile.querySelectorAll<HTMLElement>('span, div'));
    for (const el of textElements) {
      const text = el.textContent?.trim();
      if (
        text &&
        text.length > 1 &&
        text.length < 40 &&
        !SYSTEM_ICON_STRINGS.has(text) &&
        !text.toLowerCase().includes('presentation') &&
        !text.toLowerCase().includes('презентац') &&
        !text.toLowerCase().includes('more options')
      ) {
        return text;
      }
    }

    return 'Учень / Presentation';
  }

  /**
   * Find the Pin button inside a tile.
   */
  public findPinButton(tile: HTMLElement): HTMLButtonElement | null {
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = btn.textContent || '';

      const isUnpin =
        label.includes('unpin') ||
        label.includes('відкріп') ||
        label.includes('откреп') ||
        tooltip.includes('unpin') ||
        tooltip.includes('відкріп') ||
        text.includes('keep_off');

      if (isUnpin) continue;

      const isPin =
        label.includes('pin') ||
        label.includes('закріп') ||
        tooltip.includes('pin') ||
        tooltip.includes('закріп') ||
        text.includes('keep_outline');

      if (isPin) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Find the Unpin button inside a tile.
   */
  public findUnpinButton(tile: HTMLElement): HTMLButtonElement | null {
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of buttons) {
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
        return btn;
      }
    }
    return null;
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
}
