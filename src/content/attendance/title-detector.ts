/**
 * Detects active Google Meet meeting/call title from the DOM.
 */
export class CallTitleDetector {
  private currentTitle: string | null = null;
  private observer: MutationObserver | null = null;
  private pollTimer: any = null;
  private listeners: Array<(title: string) => void> = [];

  // Verified selectors from Google Meet DOM
  private static readonly TITLE_SELECTORS = [
    'div[role="heading"] [jsname="NeC6gb"].u6vdEc',
    '[jsname="NeC6gb"].u6vdEc',
    'div[role="heading"] .u6vdEc',
    '.ND08le .u6vdEc',
    '.EY8ABd-OWXEXe-TAWMXe[role="tooltip"]',
    'div[role="heading"][aria-level="1"] button div',
  ];

  private static readonly IGNORED_STRINGS = new Set([
    '',
    'meeting details',
    'деталі зустрічі',
    'детали встречи',
    'meet',
    'google meet',
  ]);

  public extractTitle(root: ParentNode = document): string | null {
    for (const selector of CallTitleDetector.TITLE_SELECTORS) {
      try {
        const el = root.querySelector(selector);
        if (el && el.textContent) {
          const raw = el.textContent.trim();
          if (raw && !CallTitleDetector.IGNORED_STRINGS.has(raw.toLowerCase())) {
            return raw;
          }
        }
      } catch {
        // Ignore selector errors on non-standard mock roots
      }
    }
    return null;
  }

  public getCurrentTitle(): string | null {
    return this.currentTitle;
  }

  public start(): void {
    if (typeof document === 'undefined') return;

    this.checkTitle();

    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => {
        this.checkTitle();
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    // Polling backup for dynamically loaded titles
    this.pollTimer = setInterval(() => {
      this.checkTitle();
    }, 2000);
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public onTitleChange(listener: (title: string) => void): () => void {
    this.listeners.push(listener);
    if (this.currentTitle) {
      listener(this.currentTitle);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private checkTitle(): void {
    const detected = this.extractTitle();
    if (detected && detected !== this.currentTitle) {
      this.currentTitle = detected;
      for (const listener of this.listeners) {
        try {
          listener(detected);
        } catch (err) {
          console.error('[MeetSwitcher:CallTitleDetector] Listener error:', err);
        }
      }
    }
  }
}
