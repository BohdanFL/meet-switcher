import type {
  LogCategory,
  LogEvent,
  SessionLog,
  DomSnapshot,
  DomTileInfo,
  LoggerConfig,
} from './types.ts';

const STORAGE_KEY_SESSIONS = 'meet_switcher_diagnostic_sessions';
const DEFAULT_MAX_EVENTS = 1000;
const DEFAULT_MAX_STORED_SESSIONS = 5;

export class DiagnosticsLogger {
  private static instance: DiagnosticsLogger | null = null;
  private config: Required<LoggerConfig>;
  private session: SessionLog;
  private startTimestamp: number;
  private syncTimer: any = null;
  private isEnded = false;
  private hasJoinedMeeting = false;
  private participantSet = new Set<string>();

  constructor(config?: LoggerConfig) {
    this.config = {
      maxEvents: config?.maxEvents ?? DEFAULT_MAX_EVENTS,
      enableStorageSync: config?.enableStorageSync ?? true,
      maxStoredSessions: config?.maxStoredSessions ?? DEFAULT_MAX_STORED_SESSIONS,
    };

    this.startTimestamp = Date.now();
    const sessionId = `session-${new Date().toISOString().replace(/[:.]/g, '-')}`;

    this.session = {
      id: sessionId,
      startTime: new Date().toISOString(),
      meetUrl: typeof window !== 'undefined' ? window.location.href : 'https://meet.google.com/test',
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      errorCount: 0,
      detectedParticipants: [],
      events: [],
    };

    // Periodically sync session summary to chrome.storage.local every 10 seconds
    if (this.config.enableStorageSync && typeof chrome !== 'undefined' && chrome.storage?.local) {
      this.syncTimer = setInterval(() => {
        try {
          if (!this.isExtensionContextValid(chrome)) {
            if (this.syncTimer) {
              clearInterval(this.syncTimer);
              this.syncTimer = null;
            }
            return;
          }
          this.persistToStorage().catch(() => {});
        } catch {
          if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
          }
        }
      }, 10000);
      if (typeof this.syncTimer?.unref === 'function') {
        this.syncTimer.unref();
      }
    }
  }

  public static getInstance(config?: LoggerConfig): DiagnosticsLogger {
    if (!DiagnosticsLogger.instance) {
      DiagnosticsLogger.instance = new DiagnosticsLogger(config);
    }
    return DiagnosticsLogger.instance;
  }

  /**
   * Log an event with category and details.
   */
  public log(
    category: LogCategory,
    message: string,
    details?: Record<string, any>,
    snapshot?: DomSnapshot
  ): LogEvent {
    const now = Date.now();
    const event: LogEvent = {
      id: `evt-${now}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date(now).toISOString(),
      elapsedMs: now - this.startTimestamp,
      category,
      message,
      details,
      snapshot,
    };

    if (category === 'ERROR') {
      this.session.errorCount++;
    }

    // Circular ring buffer
    if (this.session.events.length >= this.config.maxEvents) {
      this.session.events.shift();
    }
    this.session.events.push(event);

    // Also echo to console with badge
    const prefix = `[MeetSwitcher:${category}]`;
    if (category === 'ERROR') {
      console.error(prefix, message, details || '');
    } else if (category === 'WARN') {
      console.warn(prefix, message, details || '');
    } else {
      console.log(prefix, message, details || '');
    }

    return event;
  }

  public setMeetingJoined(joined = true): void {
    this.hasJoinedMeeting = joined;
    this.session.hasJoinedMeeting = joined;
  }

  public isMeetingJoined(): boolean {
    return this.hasJoinedMeeting;
  }

  /**
   * Record a student switch action.
   */
  public recordSwitch(
    studentName: string,
    index: number,
    success: boolean,
    reason?: string
  ): void {
    this.setMeetingJoined(true);
    this.session.totalSwitches++;
    if (success) {
      this.session.successfulSwitches++;
      this.log('ACTION', `Switched to [${index}] ${studentName}`, { success: true });
    } else {
      this.session.failedSwitches++;
      this.log('WARN', `Failed to switch to [${index}] ${studentName}: ${reason || 'Unknown'}`, {
        success: false,
        reason,
      });
    }
  }

  /**
   * Track newly identified presentation participant name.
   */
  public recordParticipantFound(name: string): void {
    if (!name) return;
    this.setMeetingJoined(true);
    if (this.participantSet.has(name)) return;
    this.participantSet.add(name);
    this.session.detectedParticipants = Array.from(this.participantSet);
    this.log('SCAN', `Registered participant screen: ${name}`);
  }

  /**
   * Capture a DOM snapshot of all active video tiles and controls.
   */
  public captureDomSnapshot(isPinnedActive = false): DomSnapshot {
    if (typeof document === 'undefined') {
      return {
        timestamp: new Date().toISOString(),
        videoCount: 0,
        isPinnedActive,
        tiles: [],
      };
    }

    const videos = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    const tiles: DomTileInfo[] = [];

    for (const video of videos) {
      const tile =
        (video.closest(
          '[data-participant-id], [data-requested-participant-id], [data-tile-media-id], div.oZRSLe, div[data-allocation-index]'
        ) as HTMLElement | null) || video.parentElement;

      if (!tile) continue;

      const buttons = Array.from(tile.querySelectorAll<HTMLButtonElement>('button')).map((b) => {
        const label = b.getAttribute('aria-label') || undefined;
        const tooltip = b.getAttribute('data-tooltip') || undefined;
        const text = b.textContent?.trim() || undefined;
        return {
          ariaLabel: label,
          tooltip,
          text,
          isPin: Boolean(label?.toLowerCase().includes('pin') || text?.includes('keep_outline')),
          isUnpin: Boolean(label?.toLowerCase().includes('unpin') || text?.includes('keep_off')),
        };
      });

      const ariaLabel = tile.getAttribute('aria-label');
      const dataTileType = tile.getAttribute('data-tile-type');
      const text = tile.textContent?.slice(0, 150) || '';

      tiles.push({
        id: tile.getAttribute('data-participant-id') || tile.id || `tile-${tiles.length}`,
        tag: tile.tagName,
        isPresentation:
          Boolean(ariaLabel?.toLowerCase().includes('presentation')) ||
          Boolean(ariaLabel?.toLowerCase().includes('презентац')) ||
          text.includes('present_to_all') ||
          text.includes('screen_share') ||
          text.includes('zoom_in') ||
          text.includes('zoom_out') ||
          text.includes('open_in_full') ||
          text.includes('ink-canvas') ||
          buttons.some(
            (b) =>
              (b.ariaLabel || '').toLowerCase().includes('presentation') ||
              (b.ariaLabel || '').toLowerCase().includes('презентац')
          ),
        classificationReason: ariaLabel || text.slice(0, 60),
        participantName: ariaLabel || 'Unknown',
        ariaLabel,
        dataTileType,
        buttons,
        textSnippet: text.replace(/\s+/g, ' ').trim(),
      });
    }

    return {
      timestamp: new Date().toISOString(),
      videoCount: videos.length,
      isPinnedActive,
      tiles,
    };
  }

  public getEvents(): LogEvent[] {
    return [...this.session.events];
  }

  public getSession(): SessionLog {
    this.session.durationSeconds = Math.round((Date.now() - this.startTimestamp) / 1000);
    return {
      ...this.session,
      detectedParticipants: Array.from(this.participantSet),
    };
  }

  public exportSessionJson(): string {
    const session = this.getSession();
    return JSON.stringify(session, null, 2);
  }

  /**
   * Finalize session when meeting concludes.
   */
  public endSession(): SessionLog {
    if (this.isEnded) return this.getSession();
    this.isEnded = true;

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.session.endTime = new Date().toISOString();
    this.session.durationSeconds = Math.round((Date.now() - this.startTimestamp) / 1000);
    this.log('SYSTEM', `Call ended. Duration: ${this.session.durationSeconds}s, switches: ${this.session.totalSwitches}`);

    if (this.hasJoinedMeeting || this.session.detectedParticipants.length > 0 || this.session.totalSwitches > 0) {
      this.persistToStorage().catch(() => {});
    }
    return this.getSession();
  }

  /**
   * Safe check for whether the extension context is still alive.
   * When an extension is reloaded or updated in chrome://extensions, existing content scripts
   * become orphaned and accessing chrome.* APIs throws "Extension context invalidated".
   */
  public isExtensionContextValid(chromeObj?: any): boolean {
    const obj = chromeObj || (typeof chrome !== 'undefined' ? chrome : (globalThis as any).chrome);
    if (!obj) return false;
    try {
      if (obj.runtime && !obj.runtime.id) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persist current session into chrome.storage.local rolling history.
   */
  public async persistToStorage(): Promise<void> {
    const chromeObj = typeof chrome !== 'undefined' ? chrome : (globalThis as any).chrome;
    if (
      !this.config.enableStorageSync ||
      !chromeObj?.storage?.local ||
      !this.isExtensionContextValid(chromeObj)
    ) {
      if (!this.isExtensionContextValid(chromeObj) && this.syncTimer) {
        clearInterval(this.syncTimer);
        this.syncTimer = null;
      }
      return;
    }

    // Do not persist unjoined ghost sessions to storage
    if (
      !this.hasJoinedMeeting &&
      this.session.detectedParticipants.length === 0 &&
      this.session.totalSwitches === 0
    ) {
      return;
    }

    try {
      const sessionData = this.getSession();
      const current = await chromeObj.storage.local.get(STORAGE_KEY_SESSIONS);
      const sessions: SessionLog[] = Array.isArray(current[STORAGE_KEY_SESSIONS])
        ? current[STORAGE_KEY_SESSIONS]
        : [];

      // Replace or prepend
      const existingIdx = sessions.findIndex((s) => s.id === sessionData.id);
      if (existingIdx >= 0) {
        sessions[existingIdx] = sessionData;
      } else {
        sessions.unshift(sessionData);
      }

      // Limit to maxStoredSessions
      if (sessions.length > this.config.maxStoredSessions) {
        sessions.length = this.config.maxStoredSessions;
      }

      await chromeObj.storage.local.set({ [STORAGE_KEY_SESSIONS]: sessions });
    } catch (err: any) {
      if (err?.message?.includes('Extension context invalidated') || !this.isExtensionContextValid(chromeObj)) {
        if (this.syncTimer) {
          clearInterval(this.syncTimer);
          this.syncTimer = null;
        }
        return;
      }
      console.warn('[MeetSwitcher] Failed to persist session to chrome.storage.local', err);
    }
  }
}
