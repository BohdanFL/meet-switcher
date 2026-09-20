import type { ScreenShare } from '../types/index.ts';
import { MeetSelectors } from './ui/selectors.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Known Material Icon names rendered inside Google Meet tiles.
 * These must never be treated as participant names.
 */
const SYSTEM_ICON_STRINGS = new Set([
  'keep_outline', 'keep_off', 'volume_off', 'volume_up', 'mic_off', 'mic',
  'more_vert', 'frame_person', 'visual_effects', 'fullscreen', 'fullscreen_exit',
  'open_in_new', 'open_in_full', 'zoom_in', 'zoom_out', 'present_to_all',
  'screen_share', 'co_present', 'desktop_windows', 'devices', 'videocam',
  'videocam_off', 'remove_circle_outline', 'push_pin', 'keep', 'volume_mute',
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

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Runtime state snapshot consumed by tile-parsing heuristics.
 * Avoids coupling TileParser to the full ScreenDetector or ShareRegistry.
 */
export interface TileParserContext {
  knownShares: ReadonlyMap<string, ScreenShare>;
  knownPresentationVideos: ReadonlySet<HTMLVideoElement>;
  expectedPinnedParticipant: string | null;
  unpinnedUntil: number;
}

// ---------------------------------------------------------------------------
// TileParser
// ---------------------------------------------------------------------------

/**
 * Pure parser responsible for all Google Meet DOM tile analysis:
 * identifying presentation tiles, extracting participant names, and validating names.
 *
 * Contains NO mutable state. All stateful lookups are injected via TileParserContext.
 */
export class TileParser {
  // -------------------------------------------------------------------------
  // Pure string utilities
  // -------------------------------------------------------------------------

  normalizeParticipantName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/['"'`]/g, '');
  }

  isValidParticipantName(name: string): boolean {
    if (!name || typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (trimmed.length <= 1 || trimmed.length > 50) return false;
    if (trimmed.includes('{') || trimmed.includes('}') || trimmed.includes(';')) return false;
    if (trimmed.includes('%') || /\d+%/.test(trimmed)) return false;
    if (/^\d+$/.test(trimmed)) return false;
    if (/^\d+.*(?:%|zoom|масштаб)/i.test(trimmed)) return false;
    if (/zoom|масштаб/i.test(trimmed)) return false;
    if (SYSTEM_ICON_STRINGS.has(trimmed) || SYSTEM_ICON_STRINGS.has(trimmed.toLowerCase())) return false;
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

  cleanParticipantName(raw: string): string {
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

  isGenericFallbackName(name: string): boolean {
    const n = name.trim().toLowerCase();
    return n === 'учень / presentation' || n === 'учень' || n === 'presentation' || n === 'unknown';
  }

  isTeacherScreenName(name: string): boolean {
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

  // -------------------------------------------------------------------------
  // DOM utilities
  // -------------------------------------------------------------------------

  isMediaStreamEnded(video: HTMLVideoElement | null | undefined): boolean {
    if (!video) return false;
    try {
      if (video.ended) return true;
      const stream = (video as any).srcObject as MediaStream | null;
      if (stream) {
        if ('active' in stream && stream.active === false) return true;
        if (typeof stream.getVideoTracks === 'function') {
          const tracks = stream.getVideoTracks();
          if (tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')) return true;
        }
      }
    } catch {
      // Ignore cross-origin or sandbox errors
    }
    return false;
  }

  findTileContainer(video: HTMLVideoElement): HTMLElement | null {
    return (
      (video.closest(
        '[data-participant-id], [data-requested-participant-id], [data-tile-media-id], div.oZRSLe, div[data-allocation-index]',
      ) as HTMLElement | null) || video.parentElement
    );
  }

  // -------------------------------------------------------------------------
  // Context-aware DOM parsing
  // -------------------------------------------------------------------------

  /**
   * Check if a presentation tile is currently pinned to the main stage.
   */
  isTilePinned(tile: HTMLElement, unpinnedUntil: number): boolean {
    if (Date.now() < unpinnedUntil) return false;

    if (MeetSelectors.findUnpinButton(tile) !== null) return true;

    const zoomBtns = Array.from(
      tile.querySelectorAll<HTMLElement>('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i], i'),
    );
    const hasVisibleZoom = zoomBtns.some((btn) => {
      if (btn.offsetParent === null && btn.clientWidth === 0) return false;
      const t = btn.textContent || '';
      return (
        t.includes('zoom_in') ||
        t.includes('zoom_out') ||
        btn.matches('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i]')
      );
    });

    const hasVisibleInk = Array.from(
      tile.querySelectorAll<HTMLElement>('.ink-canvas-parent, .ink-layer-container'),
    ).some((el) => el.offsetParent !== null || el.clientWidth > 0);

    return hasVisibleZoom || hasVisibleInk;
  }

  /**
   * Determine whether a tile is a screen share rather than a webcam.
   * STRICT: NEVER accepts a tile solely based on keep_outline/keep_off,
   * since all Google Meet webcam tiles have pin buttons.
   */
  isPresentationTile(tile: HTMLElement, videoElement?: HTMLVideoElement, ctx?: TileParserContext): boolean {
    // 0. Demo mock check
    if (tile.classList.contains('mock-student-tile') || tile.closest('.mock-student-tile')) return true;

    const textContent = tile.textContent || '';

    // 1. Screen-share icon strings (Material Icons)
    if (
      textContent.includes('present_to_all') ||
      textContent.includes('screen_share') ||
      textContent.includes('co_present') ||
      textContent.includes('desktop_windows')
    ) {
      return true;
    }

    // 2. Zoom controls (only rendered for presentations!)
    if (
      textContent.includes('zoom_in') ||
      textContent.includes('zoom_out') ||
      textContent.includes('open_in_full') ||
      tile.querySelector('button[aria-label*="zoom" i], button[data-tooltip*="zoom" i]')
    ) {
      return true;
    }

    // 3. Ink annotation canvas
    if (
      tile.querySelector('.ink-canvas-parent, .ink-layer-container') ||
      tile.classList.contains('ink-canvas-parent')
    ) {
      return true;
    }

    // 4. Button aria-labels / tooltips
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

    // 6. Text badge check inside the tile
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

    // Context-dependent checks — skipped when no ctx is provided
    if (!ctx) return false;

    // 7. Persistent presentation video check (survives button fadeout)
    const video = videoElement || tile.querySelector('video');
    if (video && ctx.knownPresentationVideos.has(video as HTMLVideoElement)) return true;

    // 8. Known presentation share check
    const participantId =
      tile.getAttribute('data-participant-id') ||
      tile.getAttribute('data-requested-participant-id') ||
      tile.getAttribute('data-tile-media-id');
    if (participantId && ctx.knownShares.has(`${participantId}:pres`)) return true;

    return false;
  }

  /**
   * Extract human-readable participant name from the presentation tile.
   * Uses multiple heuristics in order of reliability.
   */
  extractParticipantName(tile: HTMLElement, ctx: TileParserContext): string {
    // 0.1 Lookup previously recorded participant name by ID
    const participantId =
      tile.getAttribute('data-participant-id') ||
      tile.getAttribute('data-requested-participant-id') ||
      tile.getAttribute('data-tile-media-id');
    if (participantId) {
      const known = ctx.knownShares.get(`${participantId}:pres`);
      if (known && this.isValidParticipantName(known.participantName) && !this.isGenericFallbackName(known.participantName)) {
        return known.participantName;
      }
    }

    const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button'));

    // Heuristic 1: Pin / Unpin button aria-label
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').trim();
      if (!label) continue;

      if (/your presentation/i.test(label) || /вашу презентацію/i.test(label) || /ваша презентація/i.test(label)) {
        return 'Ваш екран (Ви)';
      }

      const matchUa1 = label.match(
        /(?:Закріпити|Відкріпити)\s+презентацію\s+(?:користувача\s+)?(.+?)(?:\s+на головному екрані|\s+на екрані|$)/i,
      );
      if (matchUa1?.[1]) {
        const cleaned = this.cleanParticipantName(matchUa1[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }

      const matchUa2 = label.match(
        /(?:Закріпити|Відкріпити|Pin|Unpin)\s+(.+?)(?:'s presentation|\s*\(презентація\)|\s+презентацію|\s+презентацию)/i,
      );
      if (matchUa2?.[1]) {
        const cleaned = this.cleanParticipantName(matchUa2[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 2: More options button
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || '';
      const matchMore = label.match(
        /(?:More options for|Більше параметрів для|Додаткові дії для|Другие параметры для)\s+(.+)/i,
      );
      if (matchMore?.[1]) {
        const cleaned = this.cleanParticipantName(matchMore[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 3: Tile element aria-label
    const tileAria = tile.getAttribute('aria-label') || '';
    if (tileAria) {
      if (/your presentation/i.test(tileAria) || /вашу презентацію/i.test(tileAria) || /ваша презентація/i.test(tileAria)) {
        return 'Ваш екран (Ви)';
      }
      const matchTile = tileAria.match(
        /(?:Презентація\s+(?:користувача\s+)?|Presentation\s+(?:by\s+)?)(.+?)(?:\s*\(|$)/i,
      );
      if (matchTile?.[1]) {
        const cleaned = this.cleanParticipantName(matchTile[1]);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 4: Center stage match with expected or currently pinned participant
    if (this.isTilePinned(tile, ctx.unpinnedUntil)) {
      if (ctx.expectedPinnedParticipant && this.isValidParticipantName(ctx.expectedPinnedParticipant)) {
        return ctx.expectedPinnedParticipant;
      }
      for (const share of ctx.knownShares.values()) {
        if (share.isPinned && this.isValidParticipantName(share.participantName)) {
          return share.participantName;
        }
      }
    }

    // Heuristic 4.5: Google Meet's standard name badge element
    const notranslate = tile.querySelector('.notranslate');
    if (notranslate?.textContent) {
      const text = notranslate.textContent.trim();
      if (!SYSTEM_ICON_STRINGS.has(text)) {
        const cleaned = this.cleanParticipantName(text);
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    // Heuristic 5: Text elements with strict blacklist
    const textElements = Array.from(tile.querySelectorAll<HTMLElement>('span, div'));
    for (const el of textElements) {
      if (el.closest?.('button, [role="button"], [aria-label*="zoom" i]')) continue;
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
        if (this.isValidParticipantName(cleaned)) return cleaned;
      }
    }

    return 'Учень / Presentation';
  }
}
