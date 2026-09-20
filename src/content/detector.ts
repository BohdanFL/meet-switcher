import type { ScreenShare, ScreenSharesListener } from '../types/index.ts';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import { MeetSelectors } from './ui/selectors.ts';

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
  'open_in_full',
  'zoom_in',
  'zoom_out',
  'present_to_all',
  'screen_share',
  'co_present',
  'desktop_windows',
  'devices',
  'videocam',
  'videocam_off',
  'remove_circle_outline',
  'push_pin',
  'keep',
  'volume_mute',
]);

/**
 * System UI strings or action labels that should never be treated as participant names.
 */
export const SYSTEM_NAME_PATTERNS: RegExp[] = [
  /try annotating/i,
  /visible to everyone/i,
  /спробуйте анотувати/i,
  /видимо для всіх/i,
  /видимо всем/i,
  /zoom/i,
  /масштаб/i,
  /current zoom level/i,
  /рівень масштабу/i,
  /уровень масштаба/i,
  /stop presenting/i,
  /stop sharing/i,
  /зупинити показ/i,
  /припинити показ/i,
  /зупинити презентацію/i,
  /припинити презентацію/i,
  /зупинити трансляцію/i,
  /остановить показ/i,
  /остановить презентацию/i,
  /enter full screen/i,
  /exit full screen/i,
  /full screen/i,
  /повний екран/i,
  /на весь екран/i,
  /fit to screen/i,
  /вписати/i,
  /open_in_full/i,
  /ink-canvas/i,
  /ink-layer/i,
  /more options/i,
  /більше параметрів/i,
  /додаткові дії/i,
  /другие параметры/i,
  /continuously framed/i,
  /backgrounds and effects/i,
  /ефекти/i,
  /can't unmute/i,
  /не можна увімкнути/i,
  /невозможно включить/i,
  /keep_outline/i,
  /everyone can see your annotations/i,
  /усі можуть бачити ваші анотації/i,
  /все могут видеть ваши аннотации/i,
  /mic_off/i,
  /mic_none/i,
  /volume_off/i,
  /volume_up/i,
  /\d+%/,
  /^\d+$/,
];

export class ScreenDetector {
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private currentShares: ScreenShare[] = [];
  private knownShares: Map<string, ScreenShare> = new Map();
  private lastSeenMap: Map<string, number> = new Map();
  private participantSlots: Map<string, number> = new Map();
  private participantNameToSlot: Map<string, number> = new Map();
  private knownPresentationVideos: Set<HTMLVideoElement> = new Set();
  private expectedPinnedParticipant: string | null = null;
  private listeners: Set<ScreenSharesListener> = new Set();
  private scanListeners: Set<ScreenSharesListener> = new Set();
  private isScanning = false;
  private hasInitialized = false;
  private unpinnedUntil = 0;
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
   * Subscribe to every DOM scan event (even if the shares list did not change).
   * Useful for decorators that need to maintain injected DOM elements across Meet re-renders.
   */
  public onScan(listener: ScreenSharesListener): () => void {
    this.scanListeners.add(listener);
    return () => this.scanListeners.delete(listener);
  }

  /**
   * Return the latest scanned screen shares.
   */
  public getScreenShares(): ScreenShare[] {
    return this.currentShares;
  }

  /**
   * Notify detector of expected participant about to be pinned.
   */
  public setExpectedPinnedParticipant(name: string | null): void {
    this.expectedPinnedParticipant = name;
    if (name) {
      this.unpinnedUntil = 0;
    }
  }

  public getExpectedPinnedParticipant(): string | null {
    return this.expectedPinnedParticipant;
  }

  /**
   * Tries to find the currently pinned participant name from the global UI,
   * in case they were pinned manually by the user (webcam or presentation).
   */
  public getGlobalPinnedParticipantName(): string | null {
    if (this.expectedPinnedParticipant) return this.expectedPinnedParticipant;

    const unpinBtns = MeetSelectors.findGlobalUnpinButtons(document);

    const activeBtn = unpinBtns.find(btn => btn.offsetParent !== null || btn.clientWidth > 0);
    if (!activeBtn) return null;

    const label = activeBtn.getAttribute('aria-label') || activeBtn.getAttribute('data-tooltip') || '';
    
    // Check for explicit localized string matches like "Unpin <Name>" or "Відкріпити <Name>"
    const matchUa = label.match(
      /(?:Відкріпити|Unpin|Открепить)\s+(?:презентацію\s+(?:користувача\s+)?)?(.+?)(?:\s+на головному екрані|\s+на екрані|\s*\(презентація\)|\s+презентацію|\s+презентацию|'s presentation|$)/i
    );
    if (matchUa && matchUa[1]) {
      const cleaned = this.cleanParticipantName(matchUa[1]);
      if (this.isValidParticipantName(cleaned)) return cleaned;
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
    for (const share of this.knownShares.values()) {
      share.isPinned = false;
    }
    for (const share of this.currentShares) {
      share.isPinned = false;
    }
    this.notifyListeners();
  }

  /**
   * Clear any unpin suppression timeout when a new share is intentionally pinned.
   */
  public clearUnpinnedSuppress(): void {
    this.unpinnedUntil = 0;
  }

  /**
   * Normalize a participant name for deduplication.
   */
  public normalizeParticipantName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/['"’`]/g, '');
  }

  /**
   * Validate that a candidate string is a real participant name and not a system UI phrase.
   */
  public isValidParticipantName(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length <= 1 || trimmed.length > 50) return false;
    if (trimmed.includes('{') || trimmed.includes('}') || trimmed.includes(';')) return false;

    // Reject zoom percentages, numeric-only strings, or strings with %
    if (trimmed.includes('%') || /\d+%/.test(trimmed)) return false;

    // Reject pure numbers
    if (/^\d+$/.test(trimmed)) return false;

    // Reject strings starting with digit followed by % or zoom
    if (/^\d+.*(?:%|zoom|масштаб)/i.test(trimmed)) return false;

    // Reject names containing zoom or scale keywords
    if (/zoom|масштаб/i.test(trimmed)) return false;
    
    // Reject system icon strings
    if (SYSTEM_ICON_STRINGS.has(trimmed) || SYSTEM_ICON_STRINGS.has(trimmed.toLowerCase())) {
      return false;
    }

    for (const pattern of SYSTEM_NAME_PATTERNS) {
      if (pattern.test(trimmed)) return false;
    }

    const lower = trimmed.toLowerCase();
    if (
      lower === 'презентація' ||
      lower === 'presentation' ||
      lower === 'презентация' ||
      lower === 'учень / presentation' ||
      lower === 'учень'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if a video element's media stream has been ended or inactivated.
   */
  public isMediaStreamEnded(video: HTMLVideoElement | null | undefined): boolean {
    if (!video) return false;
    try {
      if (video.ended) return true;
      const stream = (video as any).srcObject as MediaStream | null;
      if (stream) {
        if ('active' in stream && stream.active === false) {
          return true;
        }
        if (typeof stream.getVideoTracks === 'function') {
          const tracks = stream.getVideoTracks();
          if (tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')) {
            return true;
          }
        }
      }
    } catch {
      // Ignore cross-origin or sandbox errors
    }
    return false;
  }



  /**
   * Check if any stream is currently pinned or displayed on the main stage.
   * Resilient to Google Meet control fadeout by checking stage geometry, zoom buttons, and ink canvas.
   */
  public isAnyStreamPinned(): boolean {
    if (Date.now() < this.unpinnedUntil) {
      return false;
    }

    // 1. Expected pinned participant set by switcher action
    if (this.expectedPinnedParticipant) return true;

    // 2. Check known shares
    if (this.currentShares.some((s) => s.isPinned)) return true;
    for (const share of this.knownShares.values()) {
      if (share.isPinned) return true;
    }

    // 3. Check for explicit unpin button on screen (English, Ukrainian, Russian, or keep_off icon)
    const unpinBtns = MeetSelectors.findGlobalUnpinButtons(document);
    if (unpinBtns.some(btn => btn.offsetParent !== null || btn.clientWidth > 0)) return true;

    // 5. Check for presentation zoom controls or ink canvas on page
    // (Google Meet ONLY renders zoom controls and ink canvas when a presentation is pinned on stage!)
    const stageElements = Array.from(document.querySelectorAll<HTMLElement>(
      'button[aria-label*="zoom" i], button[data-tooltip*="zoom" i], .ink-canvas-parent, .ink-layer-container'
    ));
    if (stageElements.some(el => el.offsetParent !== null || el.clientWidth > 0)) return true;

    // 6. Check if any video tile occupies >45% width or height, or >25% total viewport area
    try {
      if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        for (const video of videos) {
          const tile = this.findTileContainer(video);
          if (tile) {
            const rect = tile.getBoundingClientRect();
            if (
              rect.width > window.innerWidth * 0.45 &&
              rect.height > window.innerHeight * 0.45
            ) {
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
    this.scanListeners.clear();
  }

  /**
   * Scan Google Meet video elements and construct ScreenShare items.
   */
  public scan(): ScreenShare[] {
    if (this.isScanning) return this.currentShares;
    this.isScanning = true;

    try {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
        return this.currentShares;
      }
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

        // Skip ended streams
        if (this.isMediaStreamEnded(video)) {
          continue;
        }

        console.log('Check tile', tile.getAttribute('data-participant-id'), 'isPres', this.isPresentationTile(tile, video), 'name', this.extractParticipantName(tile), 'pin', !!MeetSelectors.findPinButton(tile)); if (this.isPresentationTile(tile, video)) {
          const participantId =
            tile.getAttribute('data-participant-id') ||
            tile.getAttribute('data-requested-participant-id') ||
            tile.getAttribute('data-tile-media-id') ||
            '';

          const participantName = this.extractParticipantName(tile);
          if (!this.isValidParticipantName(participantName)) {
            continue;
          }

          const tileId = participantId
            ? `${participantId}:pres`
            : `pres-${participantName.toLowerCase().replace(/\s+/g, '-')}`;

          if (seenTileIds.has(tileId)) continue;
          seenTileIds.add(tileId);

          const isPinned = this.isTilePinned(tile);
          const pinButton = MeetSelectors.findPinButton(tile);
          const unpinButton = MeetSelectors.findUnpinButton(tile);

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

      // Consolidate rawList: if multiple tiles match the same participant name (e.g. pinned stage vs filmstrip thumbnail)
      const consolidatedRawList: RawTile[] = [];
      for (const raw of rawList) {
        const norm = this.normalizeParticipantName(raw.participantName);
        const existingIdx = consolidatedRawList.findIndex((r) => {
          if (this.normalizeParticipantName(r.participantName) !== norm) return false;
          
          const rawIsReal = raw.id.includes(':pres') && !raw.id.startsWith('pres-');
          const rIsReal = r.id.includes(':pres') && !r.id.startsWith('pres-');
          
          if (rawIsReal && rIsReal && raw.id !== r.id) {
            // Do not merge if they are two distinct physical devices
            return false;
          }
          return true;
        });
        if (existingIdx >= 0) {
          const existing = consolidatedRawList[existingIdx];
          const rawIsRealDevice = raw.id.includes(':pres') && !raw.id.startsWith('pres-');

          // Choose preferred tile (pinned tile > real device > with pin/unpin button)
          const preferRaw = raw.isPinned || (!existing.isPinned && rawIsRealDevice);
          const primary = preferRaw ? raw : existing;
          const secondary = preferRaw ? existing : raw;

          consolidatedRawList[existingIdx] = {
            ...primary,
            id: (primary.id.includes(':pres') && !primary.id.startsWith('pres-')) ? primary.id : secondary.id,
            participantName: existing.participantName, // retain consistent casing
            isPinned: existing.isPinned || raw.isPinned,
            pinButton: primary.pinButton || secondary.pinButton,
            unpinButton: primary.unpinButton || secondary.unpinButton,
          };
        } else {
          consolidatedRawList.push(raw);
        }
      }

      // Determine whether ANY presentation is currently pinned
      const isAnyPinned = consolidatedRawList.some((r) => r.isPinned) || this.isAnyStreamPinned();

      // Assign stable slot indices (1..9) based on participant identity
      const usedSlots = new Set(this.participantNameToSlot.values());
      const getNextFreeSlot = (): number => {
        let slot = 1;
        while (usedSlots.has(slot)) {
          slot++;
        }
        usedSlots.add(slot);
        return slot;
      };

      const now = Date.now();
      const activeCanonicalIds = new Set<string>();

      // Update freshly scanned presentation tiles
      for (const raw of consolidatedRawList) {
        if (raw.videoElement) {
          this.knownPresentationVideos.add(raw.videoElement);
        }

        const normName = this.normalizeParticipantName(raw.participantName);
        const isGenericName = this.isGenericFallbackName(raw.participantName);

        let slot = !isGenericName ? this.participantNameToSlot.get(normName) : undefined;
        if (!slot) {
          slot = this.participantSlots.get(raw.id);
        }
        let existingShare = this.knownShares.get(raw.id);

        // Reconnect / slot migration: if this participant had a previous slot under another device ID
        if (!existingShare && !isGenericName) {
          for (const [oldId, known] of Array.from(this.knownShares.entries())) {
            const isOldStillInDom = consolidatedRawList.some((r) => r.id === oldId);
            if (
              !isOldStillInDom &&
              this.normalizeParticipantName(known.participantName) === normName
            ) {
              if (!slot) slot = known.index || this.participantSlots.get(oldId);
              this.knownShares.delete(oldId);
              this.lastSeenMap.delete(oldId);
              this.participantSlots.delete(oldId);
              existingShare = known;
              this.logger.log('SCAN', `Reconnected stream for "${raw.participantName}": migrated slot ${slot} from ${oldId} to ${raw.id}`);
              break;
            }
          }
        }

        // Clean up any stale entries in knownShares that have the same participant name under a different ID
        if (!isGenericName) {
          for (const [existingId, known] of Array.from(this.knownShares.entries())) {
            if (
              existingId !== raw.id &&
              this.normalizeParticipantName(known.participantName) === normName
            ) {
              if (!slot) slot = known.index || this.participantSlots.get(existingId);
              this.knownShares.delete(existingId);
              this.lastSeenMap.delete(existingId);
              this.participantSlots.delete(existingId);
              existingShare = known;
              this.logger.log(
                'SCAN',
                `Consolidated duplicate share for "${raw.participantName}": merged ${existingId} into ${raw.id}`
              );
            }
          }
        }

        if (!slot) {
          slot = getNextFreeSlot();
        }
        this.participantSlots.set(raw.id, slot);
        if (!isGenericName) {
          this.participantNameToSlot.set(normName, slot);
        }

        const effectiveName =
          isGenericName && existingShare && !this.isGenericFallbackName(existingShare.participantName)
            ? existingShare.participantName
            : raw.participantName;

        this.knownShares.set(raw.id, {
          ...raw,
          id: raw.id,
          participantName: effectiveName,
          index: slot,
          isAvailableInDom: true,
        });
        this.lastSeenMap.set(raw.id, now);
        activeCanonicalIds.add(raw.id);
      }

      // Handle previously known shares that are NOT in the current DOM scan
      for (const [id, share] of Array.from(this.knownShares.entries())) {
        if (!activeCanonicalIds.has(id)) {
          share.isAvailableInDom = false;

          const streamEnded = this.isMediaStreamEnded(share.videoElement);
          // If media stream is explicitly ended, prune immediately (0ms).
          // While a stream is pinned (isAnyPinned), Google Meet intentionally virtualizes off-screen tiles.
          // NEVER prune virtualized tiles on a short timer while someone is pinned! Keep them for the call duration (e.g. 15 min).
          // In grid mode (!isAnyPinned), allow a generous 60-second grace period to tolerate Meet reflows/animations.
          const maxGracePeriod = streamEnded ? 0 : (isAnyPinned ? 900000 : 60000);

          // If this share was the pinned stream, do not unpin it unless another stream was pinned
          // or global unpin was explicitly triggered
          const anotherPinned = consolidatedRawList.some((r) => r.isPinned);
          const isExplicitlyUnpinned = Date.now() < this.unpinnedUntil;
          if (anotherPinned || isExplicitlyUnpinned) {
            share.isPinned = false;
          }

          const lastSeen = this.lastSeenMap.get(id) || 0;
          if (now - lastSeen >= maxGracePeriod) {
            this.knownShares.delete(id);
            this.lastSeenMap.delete(id);
            this.participantSlots.delete(id);
            this.logger.log('SCAN', `Removed inactive participant screen (${maxGracePeriod}ms timeout): ${share.participantName}`);
          }
        }
      }

      // Build detected shares from knownShares registry: strictly 1 share per participant name
      const detectedMap = new Map<string, ScreenShare>();
      for (const share of this.knownShares.values()) {
        const norm = this.normalizeParticipantName(share.participantName);
        const existing = detectedMap.get(norm);
        if (!existing) {
          detectedMap.set(norm, share);
        } else {
          // Prefer pinned share, or the one currently present in DOM
          const preferShare = share.isPinned || (!existing.isPinned && share.isAvailableInDom);
          if (preferShare) {
            detectedMap.set(norm, {
              ...share,
              index: existing.index || share.index,
            });
          }
        }
      }
      const detected: ScreenShare[] = Array.from(detectedMap.values());

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

      for (const listener of this.scanListeners) {
        try {
          listener(detected);
        } catch (err) {
          console.error('[MeetSwitcher] Error in detector scanListener:', err);
        }
      }

      return detected;
    } catch (err) {
      this.logger.log('ERROR', 'Unexpected error during DOM scan', { error: String(err) });
      console.error('[MeetSwitcher] Unexpected error during DOM scan:', err);
      return this.currentShares;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Determine if the detected screen shares differ from the previous state.
   * Compares user-visible attributes to prevent unnecessary HUD list re-rendering and DOM flicker.
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
        a.participantName !== b.participantName
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
  public isPresentationTile(tile: HTMLElement, videoElement?: HTMLVideoElement): boolean {
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

    // 2. Zoom controls check (Google Meet ONLY renders zoom controls for presentations!)
    if (
      textContent.includes('zoom_in') ||
      textContent.includes('zoom_out') ||
      textContent.includes('open_in_full') ||
      tile.querySelector('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i]')
    ) {
      return true;
    }

    // 3. Ink annotation canvas check
    if (
      tile.querySelector('.ink-canvas-parent, .ink-layer-container') ||
      tile.classList.contains('ink-canvas-parent')
    ) {
      return true;
    }

    // 4. Button aria-labels / tooltips check
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

    // 5. Tile attribute checks
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

    // 6. Text badge check inside the tile (e.g. "Презентація: ...", "Alex (Presentation)")
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

    // 7. Persistent presentation video check: if this video element was previously verified
    // as a presentation, retain it even if buttons fade out
    const video = videoElement || tile.querySelector('video');
    if (video && this.knownPresentationVideos.has(video)) {
      return true;
    }

    // 8. Also check if participant ID or media ID was already recorded as a known presentation share
    const participantId =
      tile.getAttribute('data-participant-id') ||
      tile.getAttribute('data-requested-participant-id') ||
      tile.getAttribute('data-tile-media-id');
    if (participantId && this.knownShares.has(`${participantId}:pres`)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a presentation tile is currently pinned to the main stage.
   */
  public isTilePinned(tile: HTMLElement): boolean {
    if (Date.now() < this.unpinnedUntil) {
      return false;
    }

    // 1. Check for unpin button
    const unpinBtn = MeetSelectors.findUnpinButton(tile);
    if (unpinBtn !== null) {
      return true;
    }

    // 3. Zoom buttons or ink canvas inside this tile
    const zoomBtns = Array.from(tile.querySelectorAll<HTMLElement>('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i], i'));
    const hasVisibleZoom = zoomBtns.some(btn => {
      if (btn.offsetParent === null && btn.clientWidth === 0) return false;
      const t = btn.textContent || '';
      return t.includes('zoom_in') || t.includes('zoom_out') || btn.matches('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i]');
    });

    const hasVisibleInk = Array.from(tile.querySelectorAll<HTMLElement>('.ink-canvas-parent, .ink-layer-container')).some(el => el.offsetParent !== null || el.clientWidth > 0);

    if (hasVisibleZoom || hasVisibleInk) {
      return true;
    }

    

    return false;
  }

  /**
   * Extract human-readable participant name from the presentation tile.
   */
  public extractParticipantName(tile: HTMLElement): string {
    // 0.1 Check if this tile's participant ID matches an already known non-generic participant share
    const participantId =
      tile.getAttribute('data-participant-id') ||
      tile.getAttribute('data-requested-participant-id') ||
      tile.getAttribute('data-tile-media-id');
    if (participantId) {
      const known = this.knownShares.get(`${participantId}:pres`);
      if (
        known &&
        this.isValidParticipantName(known.participantName) &&
        !this.isGenericFallbackName(known.participantName)
      ) {
        return known.participantName;
      }
    }

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
        const cleaned = this.cleanParticipantName(matchUa1[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }

      // "Закріпити <Name> (презентація)" or "Pin <Name>'s presentation"
      const matchUa2 = label.match(
        /(?:Закріпити|Відкріпити|Pin|Unpin)\s+(.+?)(?:'s presentation|\s*\(презентація\)|\s+презентацію|\s+презентацию)/i
      );
      if (matchUa2 && matchUa2[1]) {
        const cleaned = this.cleanParticipantName(matchUa2[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 2: "More options for <Name>" or localized equivalent
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || '';
      const matchMore = label.match(
        /(?:More options for|Більше параметрів для|Додаткові дії для|Другие параметры для)\s+(.+)/i
      );
      if (matchMore && matchMore[1]) {
        const cleaned = this.cleanParticipantName(matchMore[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
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
        const cleaned = this.cleanParticipantName(matchTile[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 4: Center stage match with expected or currently pinned participant
    if (this.isTilePinned(tile)) {
      if (this.expectedPinnedParticipant && this.isValidParticipantName(this.expectedPinnedParticipant)) {
        return this.expectedPinnedParticipant;
      }
      for (const share of this.knownShares.values()) {
        if (share.isPinned && this.isValidParticipantName(share.participantName)) {
          return share.participantName;
        }
      }
    }

    // Heuristic 4.5: Prefer Google Meet's standard name badge element (.notranslate)
    const notranslate = tile.querySelector('.notranslate');
    if (notranslate && notranslate.textContent) {
      const text = notranslate.textContent.trim();
      if (!SYSTEM_ICON_STRINGS.has(text)) {
        const cleaned = this.cleanParticipantName(text);
        if (this.isValidParticipantName(cleaned)) {
          return cleaned;
        }
      }
    }

    // Heuristic 5: Inspect text elements within the tile (with strict blacklist)
    const textElements = Array.from(tile.querySelectorAll<HTMLElement>('span, div'));
    for (const el of textElements) {
      // Ignore controls and buttons (e.g. zoom controls, full screen controls)
      if (el.closest && el.closest('button, [role="button"], [aria-label*="zoom" i]')) {
        continue;
      }
      const text = el.textContent?.trim();
      if (
        text &&
        text.length > 1 &&
        text.length < 40 &&
        !SYSTEM_ICON_STRINGS.has(text) &&
        !text.includes('{') &&
        !text.includes('}')
      ) {
        const cleaned = this.cleanParticipantName(text);
        if (this.isValidParticipantName(cleaned)) {
          return cleaned;
        }
      }
    }

    return 'Учень / Presentation';
  }

  private isGenericFallbackName(name: string): boolean {
    const n = name.trim().toLowerCase();
    return n === 'учень / presentation' || n === 'учень' || n === 'presentation' || n === 'unknown';
  }

  public isTeacherScreenName(name: string): boolean {
    if (!name) return false;
    const lower = name.toLowerCase();
    return (
      lower.includes('ваш екран') ||
      lower.includes('ваша презентація') ||
      lower.includes('вашу презентацію') ||
      lower.includes('ваша презентация') ||
      lower.includes('your presentation') ||
      lower.includes('ви транслюєте') ||
      lower.includes('you are presenting') ||
      lower.includes('вы транслируете') ||
      lower.includes('ви показуєте') ||
      lower.includes('stop presenting') ||
      lower.includes('зупинити показ')
    );
  }

  public cleanParticipantName(raw: string): string {
    return raw
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*)/i, '')
      .replace(/\s*\(презентація\)/i, '')
      .replace(/\s*\(presentation\)/i, '')
      .replace(/\s*\(презентация\)/i, '')
      .replace(/\s*\(You\)$/i, '')
      .replace(/\s*\(Ви\)$/i, '')
      .replace(/\s*\(Вы\)$/i, '')
      .replace(/^(?:користувача\s+|користувач\s+)/i, '')
      .replace(/\s+на головному екрані$/i, '')
      .replace(/'s presentation$/i, '')
      .trim();
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
