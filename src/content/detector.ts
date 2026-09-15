import { ScreenShare, ScreenSharesListener } from '../types';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';

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
  'present_to_all',
  'screen_share',
  'co_present',
  'desktop_windows',
]);

export class ScreenDetector {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private currentShares: ScreenShare[] = [];
  private knownShares: Map<string, ScreenShare> = new Map();
  private lastSeenMap: Map<string, number> = new Map();
  private participantSlots: Map<string, number> = new Map();
  private listeners: Set<ScreenSharesListener> = new Set();
  private isScanning = false;
  private hasInitialized = false;
  private logger = DiagnosticsLogger.getInstance();

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
   * Check if any stream is currently pinned on screen.
   */
  public isAnyStreamPinned(): boolean {
    if (this.currentShares.some((s) => s.isPinned)) return true;
    for (const share of this.knownShares.values()) {
      if (share.isPinned) return true;
    }

    const unpinBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="unpin" i], button[aria-label*="відкріп" i], button[aria-label*="откреп" i], button[data-tooltip*="unpin" i], button[data-tooltip*="відкріп" i]'
    );
    if (unpinBtn) return true;

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    return buttons.some((b) => (b.textContent || '').includes('keep_off'));
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

        if (this.isPresentationTile(tile)) {
          const participantId =
            tile.getAttribute('data-participant-id') ||
            tile.getAttribute('data-requested-participant-id') ||
            tile.getAttribute('data-tile-media-id') ||
            '';

          const participantName = this.extractParticipantName(tile);
          const tileId = participantId
            ? `${participantId}:pres`
            : `pres-${participantName.toLowerCase().replace(/\s+/g, '-')}`;

          if (seenTileIds.has(tileId)) continue;
          seenTileIds.add(tileId);

          const isPinned = this.isTilePinned(tile);
          const pinButton = this.findPinButton(tile);
          const unpinButton = this.findUnpinButton(tile);

          this.logger.recordParticipantFound(participantName);

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

      // Determine whether ANY presentation is currently pinned
      const isAnyPinned = rawList.some((r) => r.isPinned) || this.isAnyStreamPinned();

      // Assign stable slot indices (1..9)
      const usedSlots = new Set(this.participantSlots.values());
      const getNextFreeSlot = (): number => {
        let slot = 1;
        while (usedSlots.has(slot)) {
          slot++;
        }
        usedSlots.add(slot);
        return slot;
      };

      const now = Date.now();

      // Update freshly scanned presentation tiles
      for (const raw of rawList) {
        if (!this.participantSlots.has(raw.id)) {
          this.participantSlots.set(raw.id, getNextFreeSlot());
        }

        const slot = this.participantSlots.get(raw.id)!;
        this.knownShares.set(raw.id, {
          ...raw,
          index: slot,
          isAvailableInDom: true,
        });
        this.lastSeenMap.set(raw.id, now);
      }

      // Handle previously known shares that are NOT in the current DOM scan
      const activeRawIds = new Set(rawList.map((r) => r.id));
      for (const [id, share] of Array.from(this.knownShares.entries())) {
        if (!activeRawIds.has(id)) {
          if (isAnyPinned) {
            // Meet is in sidebar mode (only ~3 tiles rendered). DO NOT DELETE other students!
            // Retain them in knownShares with isAvailableInDom = false.
            share.isPinned = false;
            share.isAvailableInDom = false;
          } else {
            // Meet is in full grid view. Prune only if missing for > 3500ms (grace period)
            const lastSeen = this.lastSeenMap.get(id) || 0;
            if (now - lastSeen > 3500) {
              this.knownShares.delete(id);
              this.lastSeenMap.delete(id);
              this.participantSlots.delete(id);
              this.logger.log('SCAN', `Removed inactive participant screen: ${share.participantName}`);
            } else {
              share.isPinned = false;
              share.isAvailableInDom = false;
            }
          }
        }
      }

      // Build detected shares from knownShares registry
      const detected: ScreenShare[] = Array.from(this.knownShares.values());

      // Sort by index (1..9) so order remains rock-solid
      detected.sort((a, b) => a.index - b.index);

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
        a.videoElement !== b.videoElement ||
        a.isAvailableInDom !== b.isAvailableInDom
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
   * STRICT: NEVER accepts a tile solely based on keep_outline/keep_off,
   * since all Google Meet webcam tiles have pin buttons!
   */
  private isPresentationTile(tile: HTMLElement): boolean {
    // 0. Demo mock check
    if (tile.classList.contains('mock-student-tile') || tile.closest('.mock-student-tile')) {
      return true;
    }

    const textContent = tile.textContent || '';

    // 1. Icon checks (Material Icons specific to screen shares)
    if (
      textContent.includes('present_to_all') ||
      textContent.includes('screen_share') ||
      textContent.includes('co_present') ||
      textContent.includes('desktop_windows')
    ) {
      return true;
    }

    // 2. Button aria-labels / tooltips check
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

      if (
        label.includes('presentation') ||
        label.includes('презентац') ||
        label.includes('screen share') ||
        label.includes('показ екран') ||
        label.includes('демонстрац') ||
        tooltip.includes('presentation') ||
        tooltip.includes('презентац') ||
        tooltip.includes('screen share') ||
        tooltip.includes('показ екран') ||
        tooltip.includes('демонстрац')
      ) {
        return true;
      }
    }

    // 3. Tile attribute checks
    const tileAttrs = (
      tile.getAttribute('aria-label') ||
      tile.getAttribute('data-tile-type') ||
      tile.getAttribute('data-stream-type') ||
      ''
    ).toLowerCase();

    if (
      tileAttrs.includes('presentation') ||
      tileAttrs.includes('презентац') ||
      tileAttrs.includes('screen share') ||
      tileAttrs.includes('показ екран') ||
      tileAttrs.includes('демонстрац')
    ) {
      return true;
    }

    // 4. Text badge check inside the tile (e.g. "Презентація: ...", "Alex (Presentation)")
    const badges = Array.from(tile.querySelectorAll<HTMLElement>('span, div'));
    for (const b of badges) {
      const txt = (b.textContent || '').trim().toLowerCase();
      if (
        txt === 'презентація' ||
        txt === 'presentation' ||
        txt === 'презентация' ||
        txt.startsWith('презентація:') ||
        txt.startsWith('presentation:') ||
        txt.startsWith('презентация:') ||
        txt.endsWith('(презентація)') ||
        txt.endsWith('(presentation)') ||
        txt.endsWith('(презентация)') ||
        txt.includes('ваша презентація') ||
        txt.includes('your presentation') ||
        txt.includes('ви транслюєте екран') ||
        txt.includes('you are presenting')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a presentation tile is currently pinned to the main stage.
   */
  private isTilePinned(tile: HTMLElement): boolean {
    // 1. Check for unpin button
    const unpinBtn = this.findUnpinButton(tile);
    if (unpinBtn !== null) {
      return true;
    }

    // 2. Check for keep_off icon string within this tile
    const textContent = tile.textContent || '';
    if (textContent.includes('keep_off')) {
      return true;
    }

    // 3. Check if tile occupies main center stage (>50% width and height of viewport)
    try {
      const rect = tile.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
        // If it occupies majority of screen and has no Pin button, it is the pinned tile
        if (this.findPinButton(tile) === null) {
          return true;
        }
      }
    } catch {
      // Ignore geometry errors
    }

    return false;
  }

  /**
   * Extract human-readable participant name from the presentation tile.
   */
  private extractParticipantName(tile: HTMLElement): string {
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));

    // Heuristic 1: Pin / Unpin button aria-label
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').trim();
      if (!label) continue;

      if (
        /your presentation/i.test(label) ||
        /вашу презентацію/i.test(label) ||
        /ваша презентація/i.test(label)
      ) {
        return 'Ваш екран (Ви)';
      }

      // "Закріпити презентацію користувача <Name>" or "Закріпити презентацію: <Name>"
      const matchUa1 = label.match(
        /(?:Закріпити|Відкріпити)\s+презентацію\s+(?:користувача\s+)?(.+?)(?:\s+на головному екрані|\s+на екрані|$)/i
      );
      if (matchUa1 && matchUa1[1]) {
        return this.cleanParticipantName(matchUa1[1]);
      }

      // "Закріпити <Name> (презентація)" or "Pin <Name>'s presentation"
      const matchUa2 = label.match(
        /(?:Закріпити|Відкріпити|Pin|Unpin)\s+(.+?)(?:'s presentation|\s*\(презентація\)|\s+презентацію|\s+презентацию)/i
      );
      if (matchUa2 && matchUa2[1]) {
        return this.cleanParticipantName(matchUa2[1]);
      }
    }

    // Heuristic 2: "More options for <Name>" or localized equivalent
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || '';
      const matchMore = label.match(
        /(?:More options for|Більше параметрів для|Додаткові дії для|Другие параметры для)\s+(.+)/i
      );
      if (matchMore && matchMore[1]) {
        return this.cleanParticipantName(matchMore[1]);
      }
    }

    // Heuristic 3: Tile element aria-label
    const tileAria = tile.getAttribute('aria-label') || '';
    if (tileAria) {
      if (
        /your presentation/i.test(tileAria) ||
        /вашу презентацію/i.test(tileAria) ||
        /ваша презентація/i.test(tileAria)
      ) {
        return 'Ваш екран (Ви)';
      }
      const matchTile = tileAria.match(
        /(?:Презентація\s+(?:користувача\s+)?|Presentation\s+(?:by\s+)?)(.+?)(?:\s*\(|$)/i
      );
      if (matchTile && matchTile[1]) {
        return this.cleanParticipantName(matchTile[1]);
      }
    }

    // Heuristic 4: Inspect text elements within the tile
    const textElements = Array.from(tile.querySelectorAll<HTMLElement>('span, div'));
    for (const el of textElements) {
      const text = el.textContent?.trim();
      if (
        text &&
        text.length > 1 &&
        text.length < 40 &&
        !SYSTEM_ICON_STRINGS.has(text) &&
        !text.toLowerCase().includes('more options')
      ) {
        const cleaned = this.cleanParticipantName(text);
        if (cleaned.length > 1 && !/^(?:презентація|presentation|презентация)$/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    return 'Учень / Presentation';
  }

  private cleanParticipantName(raw: string): string {
    return raw
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*)/i, '')
      .replace(/\s*\(презентація\)$/i, '')
      .replace(/\s*\(presentation\)$/i, '')
      .replace(/\s*\(презентация\)$/i, '')
      .replace(/^(?:користувача\s+|користувач\s+)/i, '')
      .replace(/\s+на головному екрані$/i, '')
      .replace(/'s presentation$/i, '')
      .trim();
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
