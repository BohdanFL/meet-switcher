import type { ScreenShare, ScreenSharesListener } from '../types/index.ts';
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
  'open_in_full',
  'zoom_in',
  'zoom_out',
  'present_to_all',
  'screen_share',
  'co_present',
  'desktop_windows',
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
   * Determine whether a tile is the teacher's own presentation.
   * Checks for "Stop presenting" buttons, "Your presentation" badges, etc.
   */
  public isTeacherPresentationTile(tile: HTMLElement): boolean {
    if (!tile) return false;

    // 1. Check tile aria-label
    const tileAria = (tile.getAttribute('aria-label') || '').toLowerCase();
    if (
      tileAria.includes('your presentation') ||
      tileAria.includes('ваша презентація') ||
      tileAria.includes('вашу презентацію') ||
      tileAria.includes('ваша презентация') ||
      tileAria.includes('ви транслюєте') ||
      tileAria.includes('you are presenting') ||
      tileAria.includes('вы транслируете')
    ) {
      return true;
    }

    // 2. Check for "Stop presenting" or "Your presentation" buttons inside tile
    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));
    const stopRegex = /(?:зупинити показ|припинити показ|зупинити презентацію|припинити презентацію|зупинити трансляцію|stop presenting|stop sharing|остановить показ|остановить презентацию)/i;
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      if (stopRegex.test(label) || stopRegex.test(tooltip) || stopRegex.test(text)) {
        return true;
      }

      if (
        label.includes('your presentation') ||
        label.includes('ваша презентація') ||
        label.includes('вашу презентацію') ||
        tooltip.includes('your presentation') ||
        tooltip.includes('ваша презентація')
      ) {
        return true;
      }
    }

    // 3. Check for badges or text indicating own presentation
    const textEls = Array.from(tile.querySelectorAll<HTMLElement>('span, div, p'));
    for (const el of textEls) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (
        txt.includes('ваша презентація') ||
        txt.includes('your presentation') ||
        txt.includes('ваша презентация') ||
        txt.includes('ви транслюєте екран') ||
        txt.includes('you are presenting') ||
        txt.includes('ви показуєте екран') ||
        txt.includes('зупинити показ') ||
        txt.includes('припинити показ') ||
        txt.includes('stop presenting')
      ) {
        return true;
      }
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

    // 1. Check known shares
    if (this.currentShares.some((s) => s.isPinned)) return true;
    for (const share of this.knownShares.values()) {
      if (share.isPinned) return true;
    }

    // 2. Check for explicit unpin button on screen (English, Ukrainian, Russian)
    const unpinBtn = document.querySelector<HTMLButtonElement>(
      'button[aria-label*="unpin" i], button[aria-label*="відкріп" i], button[aria-label*="откреп" i], button[data-tooltip*="unpin" i], button[data-tooltip*="відкріп" i], button[data-tooltip*="откреп" i]'
    );
    if (unpinBtn) return true;

    // 3. Check for keep_off icon string anywhere
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    if (buttons.some((b) => (b.textContent || '').includes('keep_off'))) return true;

    // 4. Check for presentation zoom controls or ink canvas on page
    // (Google Meet ONLY renders zoom controls and ink canvas when a presentation is pinned on stage!)
    const hasStageElement = document.querySelector(
      'button[aria-label*="zoom" i], button[data-tooltip*="zoom" i], .ink-canvas-parent, .ink-layer-container'
    );
    if (hasStageElement) return true;

    // 5. Check if any video tile occupies >50% width and >50% height of viewport
    try {
      if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
        const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
        for (const video of videos) {
          const tile = this.findTileContainer(video);
          if (tile) {
            const rect = tile.getBoundingClientRect();
            if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
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

        // Skip ended streams or teacher's own presentation
        if (this.isMediaStreamEnded(video) || this.isTeacherPresentationTile(tile)) {
          continue;
        }

        if (this.isPresentationTile(tile)) {
          const participantId =
            tile.getAttribute('data-participant-id') ||
            tile.getAttribute('data-requested-participant-id') ||
            tile.getAttribute('data-tile-media-id') ||
            '';

          const participantName = this.extractParticipantName(tile);
          if (this.isTeacherScreenName(participantName) || !this.isValidParticipantName(participantName)) {
            continue;
          }

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

      // Consolidate rawList: if a fallback pres- tile matches a device ID tile with same name, merge them
      const consolidatedRawList: RawTile[] = [];
      for (const raw of rawList) {
        const norm = this.normalizeParticipantName(raw.participantName);
        const existingIdx = consolidatedRawList.findIndex(
          (r) => this.normalizeParticipantName(r.participantName) === norm
        );
        if (existingIdx >= 0) {
          const existing = consolidatedRawList[existingIdx];
          const rawIsRealDevice = raw.id.includes(':pres') && !raw.id.startsWith('pres-');
          const existingIsRealDevice = existing.id.includes(':pres') && !existing.id.startsWith('pres-');

          // If both have different real device IDs, they are two separate accounts/devices (e.g. ЛЕОН and Леон)
          if (rawIsRealDevice && existingIsRealDevice && raw.id !== existing.id) {
            consolidatedRawList.push(raw);
            continue;
          }

          // Prefer tile with real device ID or explicit pin button
          if (rawIsRealDevice) {
            consolidatedRawList[existingIdx] = {
              ...raw,
              isPinned: existing.isPinned || raw.isPinned,
              pinButton: raw.pinButton || existing.pinButton,
              unpinButton: raw.unpinButton || existing.unpinButton,
            };
          } else {
            existing.isPinned = existing.isPinned || raw.isPinned;
            existing.pinButton = existing.pinButton || raw.pinButton;
            existing.unpinButton = existing.unpinButton || raw.unpinButton;
          }
        } else {
          consolidatedRawList.push(raw);
        }
      }

      // Determine whether ANY presentation is currently pinned
      const isAnyPinned = consolidatedRawList.some((r) => r.isPinned) || this.isAnyStreamPinned();

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
      const activeCanonicalIds = new Set<string>();

      // Update freshly scanned presentation tiles
      for (const raw of consolidatedRawList) {
        if (raw.videoElement) {
          this.knownPresentationVideos.add(raw.videoElement);
        }

        const normName = this.normalizeParticipantName(raw.participantName);
        const isGenericName = this.isGenericFallbackName(raw.participantName);

        let slot = this.participantSlots.get(raw.id);
        let existingShare = this.knownShares.get(raw.id);

        // Reconnect / slot migration: if this participant had a previous slot whose tile is no longer in DOM
        if (!existingShare && !isGenericName) {
          for (const [oldId, known] of Array.from(this.knownShares.entries())) {
            const isOldStillInDom = consolidatedRawList.some((r) => r.id === oldId);
            if (
              !isOldStillInDom &&
              this.normalizeParticipantName(known.participantName) === normName
            ) {
              slot = this.participantSlots.get(oldId);
              this.knownShares.delete(oldId);
              this.lastSeenMap.delete(oldId);
              this.participantSlots.delete(oldId);
              existingShare = known;
              this.logger.log('SCAN', `Reconnected stream for "${raw.participantName}": migrated slot ${slot} from ${oldId} to ${raw.id}`);
              break;
            }
          }
        }

        if (!slot) {
          slot = getNextFreeSlot();
        }
        this.participantSlots.set(raw.id, slot);

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
          share.isPinned = false;
          share.isAvailableInDom = false;

          const streamEnded = this.isMediaStreamEnded(share.videoElement);
          // If media stream is explicitly ended, prune immediately (0ms).
          // In grid mode (!isAnyPinned), prune after 3.5s (reflow guard).
          // When a stream is pinned (isAnyPinned), keep up to 15s to tolerate Meet DOM virtualization.
          const maxGracePeriod = streamEnded ? 0 : (isAnyPinned ? 15000 : 3500);

          const lastSeen = this.lastSeenMap.get(id) || 0;
          if (now - lastSeen >= maxGracePeriod) {
            this.knownShares.delete(id);
            this.lastSeenMap.delete(id);
            this.participantSlots.delete(id);
            this.logger.log('SCAN', `Removed inactive participant screen (${maxGracePeriod}ms timeout): ${share.participantName}`);
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
  public isPresentationTile(tile: HTMLElement): boolean {
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
    const video = tile.querySelector('video');
    if (video && this.knownPresentationVideos.has(video)) {
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
    const unpinBtn = this.findUnpinButton(tile);
    if (unpinBtn !== null) {
      return true;
    }

    // 2. Check for keep_off icon string within this tile
    const textContent = tile.textContent || '';
    if (textContent.includes('keep_off')) {
      return true;
    }

    // 3. Zoom buttons or ink canvas inside this tile
    if (
      tile.querySelector('.ink-canvas-parent, .ink-layer-container') ||
      tile.querySelector('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i]') ||
      textContent.includes('zoom_in') ||
      textContent.includes('zoom_out')
    ) {
      return true;
    }

    // 4. Check if tile occupies main center stage (>50% width and height of viewport)
    try {
      if (typeof window !== 'undefined' && window.innerWidth && window.innerHeight) {
        const rect = tile.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.5 && rect.height > window.innerHeight * 0.5) {
          // If it occupies majority of screen and has no Pin button, it is the pinned tile
          if (this.findPinButton(tile) === null) {
            return true;
          }
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
  public extractParticipantName(tile: HTMLElement): string {
    // 0. Own presentation check
    if (this.isTeacherPresentationTile(tile)) {
      return 'Ваш екран (Ви)';
    }

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
      const cleaned = this.cleanParticipantName(notranslate.textContent.trim());
      if (this.isValidParticipantName(cleaned)) {
        return cleaned;
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
