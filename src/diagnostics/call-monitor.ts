import { DiagnosticsLogger } from './logger.ts';

const LEAVE_BUTTON_REGEX = /(?:leave call|leave meeting|end call|hang up|покинути|залишити|завершити|завершить|call_end|phone_missed)/i;

const POST_CALL_REGEX = /(?:you left the meeting|you've left the meeting|ви залишили зустріч|залишили виклик|зустріч завершилася|ви вийшли з виклику|rejoin|приєднатися знову)/i;

/**
 * Helper to determine if an aria-label or tooltip belongs to the red leave-call button.
 */
export function isLeaveButtonLabel(label: string): boolean {
  if (!label) return false;
  return LEAVE_BUTTON_REGEX.test(label.trim());
}

/**
 * Helper to check if text or message matches Meet's post-call exit screen.
 */
export function isMeetingEndedText(text: string): boolean {
  if (!text) return false;
  return POST_CALL_REGEX.test(text.trim());
}

/**
 * Helper to determine whether the user is actively inside an in-progress Google Meet meeting room
 * (as opposed to being on the landing page or in the pre-join lobby / green room).
 */
export function isUserInMeeting(doc: Document = document): boolean {
  if (!doc || !doc.body) return false;

  // 1. If path is home, landing, or bye -> not in a meeting
  if (typeof window !== 'undefined' && window.location?.pathname) {
    const p = window.location.pathname;
    if (p === '/' || p.startsWith('/landing') || p.startsWith('/bye')) {
      return false;
    }
  }

  // 2. Check for explicit Leave Call button in DOM
  const buttons = Array.from(doc.querySelectorAll<HTMLButtonElement>('button, div[role="button"]'));
  const hasLeaveButton = buttons.some((btn) => {
    const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || btn.textContent || '';
    return isLeaveButtonLabel(label);
  });
  if (hasLeaveButton) {
    return true;
  }

  // 3. Check for specific Google Meet in-call layout indicators (not present in lobby)
  const inCallSelectors = [
    '[data-meeting-title]',
    '[data-call-state]',
    'div[role="region"][aria-label*="call controls" i]',
    'div[role="region"][aria-label*="керування викликом" i]',
    'div[role="region"][aria-label*="управление вызовом" i]',
    '[data-participant-id]',
    '[data-requested-participant-id]',
    '[data-allocation-index]',
    'button[aria-label*="unpin" i]',
    'button[aria-label*="відкріп" i]',
    'button[aria-label*="откреп" i]',
    '.ink-canvas-parent',
    '.ink-layer-container',
  ];

  for (const selector of inCallSelectors) {
    if (doc.querySelector(selector)) {
      return true;
    }
  }

  // 4. Check for in-call specific buttons (like Raise Hand, Captions)
  const hasInCallAction = buttons.some((btn) => {
    const label = (btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '').toLowerCase();
    return (
      label.includes('raise hand') ||
      label.includes('підняти руку') ||
      label.includes('поднять руку') ||
      label.includes('turn on captions') ||
      label.includes('увімкнути субтитри') ||
      label.includes('включить субтитры')
    );
  });
  if (hasInCallAction) {
    return true;
  }

  return false;
}

export class CallMonitor {
  private logger: DiagnosticsLogger;
  private isMonitoring = false;
  private hasExported = false;
  private hasJoinedMeeting = false;
  private observer: MutationObserver | null = null;
  private clickListener: ((e: MouseEvent) => void) | null = null;
  private unloadListener: (() => void) | null = null;

  constructor(logger?: DiagnosticsLogger) {
    this.logger = logger || DiagnosticsLogger.getInstance();
  }

  public isInMeeting(): boolean {
    return this.hasJoinedMeeting;
  }

  public getHasExported(): boolean {
    return this.hasExported;
  }

  public markMeetingJoined(): void {
    if (this.hasJoinedMeeting) return;
    this.hasJoinedMeeting = true;
    this.logger.setMeetingJoined(true);
    this.logger.log('SYSTEM', 'User joined Google Meet meeting room.');
  }

  public start(): void {
    if (this.isMonitoring || typeof window === 'undefined') return;
    this.isMonitoring = true;

    // Check initial state in case script loaded after join
    if (typeof document !== 'undefined' && isUserInMeeting(document)) {
      this.markMeetingJoined();
    }

    // 1. Listen for clicks on the red Leave Call button
    this.clickListener = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const btn = target.closest<HTMLButtonElement>('button, div[role="button"]');
      if (!btn) return;

      const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || btn.textContent || '';
      if (isLeaveButtonLabel(label)) {
        this.markMeetingJoined();
        this.logger.log('SYSTEM', `Leave call button clicked: "${label.trim()}"`);
        // Slight timeout to let user confirm any "End for everyone" dialog if opened
        setTimeout(() => {
          this.triggerAutoExport('leave_button_clicked');
        }, 800);
      }
    };
    document.addEventListener('click', this.clickListener, true);

    // 2. Observe DOM for meeting join and post-call "You left the meeting" screen or URL change
    this.observer = new MutationObserver(() => {
      if (this.hasExported) return;

      // Check if user has entered the meeting
      if (!this.hasJoinedMeeting) {
        if (isUserInMeeting(document)) {
          this.markMeetingJoined();
        } else {
          // While user has not entered meeting room, ignore exit screens and landing URLs
          return;
        }
      }

      // Check URL
      if (window.location.pathname.includes('/landing') || window.location.pathname.includes('/bye')) {
        this.triggerAutoExport('url_changed_to_landing');
        return;
      }

      // Check text content on exit screens
      const bodyText = document.body?.innerText?.slice(0, 500) || '';
      if (isMeetingEndedText(bodyText)) {
        this.triggerAutoExport('exit_screen_detected');
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 3. Page unload fallback
    this.unloadListener = () => {
      // Do NOT export or persist sessions if the meeting was never entered
      if (!this.hasJoinedMeeting) {
        return;
      }
      this.logger.persistToStorage().catch(() => {});
      if (!this.hasExported) {
        this.triggerAutoExport('tab_closed');
      }
    };
    window.addEventListener('beforeunload', this.unloadListener);
    window.addEventListener('pagehide', this.unloadListener);
  }

  public stop(): void {
    if (!this.isMonitoring) return;
    this.isMonitoring = false;

    if (this.clickListener) {
      document.removeEventListener('click', this.clickListener, true);
      this.clickListener = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.unloadListener) {
      window.removeEventListener('beforeunload', this.unloadListener);
      window.removeEventListener('pagehide', this.unloadListener);
      this.unloadListener = null;
    }
  }

  /**
   * Trigger automatic file download of the full lesson timeline.
   */
  public triggerAutoExport(reason: string, force = false): void {
    if (this.hasExported) return;
    if (!this.hasJoinedMeeting && !force && reason !== 'manual_console_trigger') {
      return;
    }
    this.hasExported = true;

    this.logger.log('SYSTEM', `Triggering automatic post-call log export. Reason: ${reason}`);
    this.logger.endSession();

    const json = this.logger.exportSessionJson();
    const dateStr = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
    const filename = `meet-switcher-log-${dateStr}.json`;

    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    try {
      // 1. Direct browser synthetic download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);

      // 2. Show user-friendly toast confirmation
      this.showExportToast(filename);
    } catch (err) {
      console.warn('[MeetSwitcher] Synthetic download failed, session remains in storage', err);
    }
  }

  private showExportToast(filename: string): void {
    if (typeof document === 'undefined' || !document.body) return;

    const toast = document.createElement('div');
    toast.className = 'meet-switcher-export-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #202124;
      color: #e8eaed;
      border: 1px solid #8ab4f8;
      border-radius: 8px;
      padding: 14px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: meet-switcher-fade-in 0.3s ease;
    `;

    toast.innerHTML = `
      <span style="font-size: 20px;">📁</span>
      <div>
        <div style="font-weight: 600; color: #8ab4f8;">MeetSwitcher: Урок завершено</div>
        <div style="font-size: 12px; opacity: 0.85; margin-top: 2px;">Лог збережено у Завантаження: <b>${filename}</b></div>
      </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
      }
    }, 5000);
  }
}
