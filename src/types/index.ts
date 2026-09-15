/**
 * Information about a detected participant's screen share in Google Meet.
 */
export interface ScreenShare {
  /** Unique identifier derived from data-participant-id or element identity */
  id: string;

  /** Display name of the participant or presentation label (e.g., "Andrii Chernysh", "You") */
  participantName: string;

  /** 1-based index mapped to keyboard shortcuts (1..9) */
  index: number;

  /** Whether this screen share is currently pinned to the main stage */
  isPinned: boolean;

  /** DOM container element representing the video tile */
  tileElement: HTMLElement;

  /** The <video> element inside the tile */
  videoElement?: HTMLVideoElement | null;

  /** The Pin button element if found on the tile */
  pinButton?: HTMLButtonElement | null;

  /** The Unpin button element if currently pinned */
  unpinButton?: HTMLButtonElement | null;

  /** Whether the tile is currently present in the active DOM */
  isAvailableInDom?: boolean;
}

/**
 * Saved state of the HUD position and collapsed view.
 */
export interface HudState {
  x: number;
  y: number;
  collapsed: boolean;
}

/**
 * Callback function when active screen shares change.
 */
export type ScreenSharesListener = (shares: ScreenShare[]) => void;

export * from './alias.ts';

