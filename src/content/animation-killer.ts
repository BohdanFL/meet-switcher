/**
 * AnimationKiller: Injects CSS rules into Google Meet to eliminate
 * smooth tile sliding and layout reflow animations.
 *
 * This allows 1-click and hotkey switching (Alt + 1..9) to feel instantaneous
 * without waiting for Meet's 200-300ms transition animations.
 *
 * Uses 0.001ms duration instead of 'none' to ensure Chromium's transitionend
 * and animationend events still fire for any internal Meet listeners.
 */

const STYLE_ID = 'meet-switcher-kill-animations';
const STORAGE_KEY = 'meet_switcher_disable_animations';

export class AnimationKiller {
  private isEnabled: boolean = true;
  private styleEl: HTMLStyleElement | null = null;
  private onToggleListeners: Array<(enabled: boolean) => void> = [];

  constructor() {
    // Check user preference in localStorage; default to true (disabled animations)
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      this.isEnabled = saved === 'true';
    } else {
      this.isEnabled = true;
    }

    if (this.isEnabled) {
      this.apply();
    }
  }

  public isAnimationDisabled(): boolean {
    return this.isEnabled;
  }

  public toggle(): boolean {
    this.isEnabled = !this.isEnabled;
    try {
      localStorage.setItem(STORAGE_KEY, String(this.isEnabled));
    } catch {
      // Ignore localStorage write errors in sandboxed contexts
    }

    if (this.isEnabled) {
      this.apply();
    } else {
      this.remove();
    }

    for (const listener of this.onToggleListeners) {
      listener(this.isEnabled);
    }

    console.log(
      `[MeetSwitcher] Turbo mode (Meet animations off): ${this.isEnabled ? 'ENABLED' : 'DISABLED'}`
    );

    return this.isEnabled;
  }

  public onToggle(listener: (enabled: boolean) => void): void {
    this.onToggleListeners.push(listener);
  }

  public apply(): void {
    document.body.classList.add('meet-switcher-no-animations');

    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.id = STYLE_ID;
      this.styleEl.textContent = `
        /* MeetSwitcher Turbo Mode: Instant switching, eliminate Google Meet tile sliding animations */
        body.meet-switcher-no-animations div[data-participant-id],
        body.meet-switcher-no-animations div[data-allocation-index],
        body.meet-switcher-no-animations div[data-tile-id],
        body.meet-switcher-no-animations div[jscontroller],
        body.meet-switcher-no-animations div[jsname],
        body.meet-switcher-no-animations div[jsaction],
        body.meet-switcher-no-animations video,
        body.meet-switcher-no-animations .T4LgNb,
        body.meet-switcher-no-animations .A3oGJe,
        body.meet-switcher-no-animations .OEH5Id,
        body.meet-switcher-no-animations [role="region"],
        body.meet-switcher-no-animations [role="main"] * {
          transition-duration: 0.001ms !important;
          transition-delay: 0s !important;
          animation-duration: 0.001ms !important;
          animation-delay: 0s !important;
        }
      `;
      (document.head || document.documentElement).appendChild(this.styleEl);
    }
  }

  public remove(): void {
    document.body.classList.remove('meet-switcher-no-animations');
    if (this.styleEl && this.styleEl.parentElement) {
      this.styleEl.parentElement.removeChild(this.styleEl);
      this.styleEl = null;
    }
  }
}
