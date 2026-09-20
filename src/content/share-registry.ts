import type { ScreenShare } from '../types/index.ts';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import type { TileParser } from './tile-parser.ts';

// ---------------------------------------------------------------------------
// RawTile interface
// ---------------------------------------------------------------------------

/**
 * Raw data collected from a single DOM tile before registry processing.
 */
export interface RawTile {
  id: string;
  participantName: string;
  isPinned: boolean;
  tileElement: HTMLElement;
  videoElement: HTMLVideoElement;
  pinButton: HTMLButtonElement | null;
  unpinButton: HTMLButtonElement | null;
}

// ---------------------------------------------------------------------------
// ShareRegistry
// ---------------------------------------------------------------------------

/**
 * Manages the stateful registry of known screen shares:
 * - Slot assignment and stable index persistence
 * - Deduplication of filmstrip vs stage tiles for the same participant
 * - Share reconnection / ID migration across Meet reflows
 * - Pruning of inactive shares with configurable grace periods
 */
export class ShareRegistry {
  /** Presentation video elements previously verified — retained for tile persistence. */
  readonly knownPresentationVideos: Set<HTMLVideoElement> = new Set();

  private knownShares: Map<string, ScreenShare> = new Map();
  private lastSeenMap: Map<string, number> = new Map();
  private participantSlots: Map<string, number> = new Map();
  private participantNameToSlot: Map<string, number> = new Map();

  private parser: TileParser;
  private logger: DiagnosticsLogger;

  constructor(parser: TileParser, logger: DiagnosticsLogger) {
    this.parser = parser;
    this.logger = logger;
  }

  /** Read-only view of the known shares map (values are still mutable ScreenShare objects). */
  get shares(): ReadonlyMap<string, ScreenShare> {
    return this.knownShares;
  }

  /** Expose mutable map directly so ScreenDetector can proxy it for test seeding. */
  get mutableShares(): Map<string, ScreenShare> {
    return this.knownShares;
  }

  // -------------------------------------------------------------------------
  // Consolidation
  // -------------------------------------------------------------------------

  /**
   * Merge raw tiles that represent the same presentation from different DOM slots
   * (e.g. a pinned main-stage tile and a filmstrip thumbnail of the same participant).
   */
  consolidate(rawList: RawTile[]): RawTile[] {
    const result: RawTile[] = [];

    for (const raw of rawList) {
      const norm = this.parser.normalizeParticipantName(raw.participantName);
      const existingIdx = result.findIndex((r) => {
        if (this.parser.normalizeParticipantName(r.participantName) !== norm) return false;

        const rawIsReal = raw.id.includes(':pres') && !raw.id.startsWith('pres-');
        const rIsReal = r.id.includes(':pres') && !r.id.startsWith('pres-');

        // Never merge distinct physical devices (different participantIds)
        if (rawIsReal && rIsReal && raw.id !== r.id) return false;
        return true;
      });

      if (existingIdx >= 0) {
        const existing = result[existingIdx];
        const rawIsRealDevice = raw.id.includes(':pres') && !raw.id.startsWith('pres-');

        // Prefer: pinned tile > real device tile > any tile with pin/unpin button
        const preferRaw = raw.isPinned || (!existing.isPinned && rawIsRealDevice);
        const primary = preferRaw ? raw : existing;
        const secondary = preferRaw ? existing : raw;

        result[existingIdx] = {
          ...primary,
          id: primary.id.includes(':pres') && !primary.id.startsWith('pres-') ? primary.id : secondary.id,
          participantName: existing.participantName, // retain consistent casing
          isPinned: existing.isPinned || raw.isPinned,
          pinButton: primary.pinButton || secondary.pinButton,
          unpinButton: primary.unpinButton || secondary.unpinButton,
        };
      } else {
        result.push(raw);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Update the registry from a consolidated raw tile list.
   * Handles slot assignment, reconnection/migration, stale deduplication, and pruning.
   *
   * @returns Sorted, deduplicated list of detected ScreenShares (1 per participant name).
   */
  update(consolidatedRawList: RawTile[], isAnyPinned: boolean, unpinnedUntil: number, now: number): ScreenShare[] {
    const usedSlots = new Set(this.participantNameToSlot.values());
    const getNextFreeSlot = (): number => {
      let slot = 1;
      while (usedSlots.has(slot)) slot++;
      usedSlots.add(slot);
      return slot;
    };

    const activeCanonicalIds = new Set<string>();

    // Track presentation video elements for persistence across DOM reflows
    for (const raw of consolidatedRawList) {
      if (raw.videoElement) this.knownPresentationVideos.add(raw.videoElement);
    }

    // -----------------------------------------------------------------------
    // Assign slots and upsert each active tile
    // -----------------------------------------------------------------------
    for (const raw of consolidatedRawList) {
      const normName = this.parser.normalizeParticipantName(raw.participantName);
      const isGenericName = this.parser.isGenericFallbackName(raw.participantName);

      let slot = !isGenericName ? this.participantNameToSlot.get(normName) : undefined;
      if (!slot) slot = this.participantSlots.get(raw.id);
      let existingShare = this.knownShares.get(raw.id);

      // Slot migration: reconnect participant that re-appeared under a new device ID
      if (!existingShare && !isGenericName) {
        for (const [oldId, known] of Array.from(this.knownShares.entries())) {
          const isOldStillInDom = consolidatedRawList.some((r) => r.id === oldId);
          if (!isOldStillInDom && this.parser.normalizeParticipantName(known.participantName) === normName) {
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

      // Clean up stale entries that share the same participant name under a different ID
      if (!isGenericName) {
        for (const [existingId, known] of Array.from(this.knownShares.entries())) {
          if (existingId !== raw.id && this.parser.normalizeParticipantName(known.participantName) === normName) {
            if (!slot) slot = known.index || this.participantSlots.get(existingId);
            this.knownShares.delete(existingId);
            this.lastSeenMap.delete(existingId);
            this.participantSlots.delete(existingId);
            existingShare = known;
            this.logger.log('SCAN', `Consolidated duplicate share for "${raw.participantName}": merged ${existingId} into ${raw.id}`);
          }
        }
      }

      if (!slot) slot = getNextFreeSlot();
      this.participantSlots.set(raw.id, slot);
      if (!isGenericName) this.participantNameToSlot.set(normName, slot);

      // Prefer a previously resolved non-generic name over a generic one
      const effectiveName =
        isGenericName && existingShare && !this.parser.isGenericFallbackName(existingShare.participantName)
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

    // -----------------------------------------------------------------------
    // Prune inactive shares
    // -----------------------------------------------------------------------
    for (const [id, share] of Array.from(this.knownShares.entries())) {
      if (activeCanonicalIds.has(id)) continue;

      share.isAvailableInDom = false;

      // Immediately prune ended streams; keep pinned/off-screen ones much longer.
      const streamEnded = this.parser.isMediaStreamEnded(share.videoElement);
      const maxGracePeriod = streamEnded ? 0 : isAnyPinned ? 900000 : 60000;

      // Clear pin flag if another presentation is now pinned or unpin was triggered
      const anotherPinned = consolidatedRawList.some((r) => r.isPinned);
      const isExplicitlyUnpinned = Date.now() < unpinnedUntil;
      if (anotherPinned || isExplicitlyUnpinned) share.isPinned = false;

      const lastSeen = this.lastSeenMap.get(id) || 0;
      if (now - lastSeen >= maxGracePeriod) {
        this.knownShares.delete(id);
        this.lastSeenMap.delete(id);
        this.participantSlots.delete(id);
        this.logger.log('SCAN', `Removed inactive participant screen (${maxGracePeriod}ms timeout): ${share.participantName}`);
      }
    }

    // -----------------------------------------------------------------------
    // Build final list: strictly 1 entry per participant name
    // -----------------------------------------------------------------------
    const detectedMap = new Map<string, ScreenShare>();
    for (const share of this.knownShares.values()) {
      const norm = this.parser.normalizeParticipantName(share.participantName);
      const existing = detectedMap.get(norm);
      if (!existing) {
        detectedMap.set(norm, share);
      } else {
        // Prefer pinned share, or the one present in DOM
        const preferShare = share.isPinned || (!existing.isPinned && share.isAvailableInDom);
        if (preferShare) {
          detectedMap.set(norm, { ...share, index: existing.index || share.index });
        }
      }
    }

    const detected = Array.from(detectedMap.values());
    detected.sort((a, b) => a.index - b.index);
    return detected;
  }

  // -------------------------------------------------------------------------
  // Mutations called from ScreenDetector
  // -------------------------------------------------------------------------

  /** Mark all known shares as unpinned (called on global unpin). */
  markAllUnpinned(): void {
    for (const share of this.knownShares.values()) {
      share.isPinned = false;
    }
  }
}
