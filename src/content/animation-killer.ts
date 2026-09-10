/**
 * AnimationKiller: Injects CSS rules into Google Meet to eliminate
 * smooth tile sliding and layout reflow animations.
 *
 * This allows 1-click and hotkey switching (Alt + 1..9) to feel instantaneous
 * without waiting for Meet's 200-300ms transition animations.
 *
 * Appended directly to document.head / document.documentElement without any
 * selector prerequisites so that ALL Google Meet layout containers, tiles,
 * and wrappers immediately snap to their final coordinates with 0ms transition.
 */

const STYLE_ID = 'meet-switcher-kill-animations';
const STORAGE_KEY = 'meet_switcher_disable_animations';

export class AnimationKiller {
  private isEnabled: boolean = true;
  private styleEl: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private onToggleListeners: Array<(enabled: boolean) => void> = [];

  constructor() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      this.isEnabled = saved === 'true';
    } else {
      this.isEnabled = true; // Enabled by default
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
      // Ignore localStorage write errors
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
    if (!this.styleEl) {
      this.styleEl = document.createElement('style');
      this.styleEl.id = STYLE_ID;
      this.styleEl.textContent = `
        /* MeetSwitcher Turbo Mode: Completely disable all transitions & animations */
        *,
        *::before,
        *::after {
          -webkit-transition: none !important;
          -moz-transition: none !important;
          -o-transition: none !important;
          transition: none !important;
          -webkit-transition-property: none !important;
          transition-property: none !important;
          -webkit-transition-duration: 0s !important;
          transition-duration: 0s !important;
          -webkit-transition-delay: 0s !important;
          transition-delay: 0s !important;
          -webkit-animation: none !important;
          -moz-animation: none !important;
          animation: none !important;
          -webkit-animation-duration: 0s !important;
          animation-duration: 0s !important;
          -webkit-animation-delay: 0s !important;
          animation-delay: 0s !important;
          scroll-behavior: auto !important;
        }
      `;
    }

    const targetParent = document.head || document.documentElement;
    if (!document.getElementById(STYLE_ID) && targetParent) {
      targetParent.appendChild(this.styleEl);
    }

    // Set attribute on documentElement
    document.documentElement.setAttribute('data-meet-switcher-turbo', 'true');
    if (document.body) {
      document.body.classList.add('meet-switcher-no-animations');
    }

    // MutationObserver to ensure Google Meet SPA transitions never remove our stylesheet
    if (!this.observer && typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => {
        if (this.isEnabled && this.styleEl && !document.getElementById(STYLE_ID)) {
          const parent = document.head || document.documentElement;
          if (parent) {
            parent.appendChild(this.styleEl);
          }
        }
      });

      this.observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }
  }

  public remove(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    document.documentElement.removeAttribute('data-meet-switcher-turbo');
    if (document.body) {
      document.body.classList.remove('meet-switcher-no-animations');
    }

    const el = document.getElementById(STYLE_ID);
    if (el && el.parentElement) {
      el.parentElement.removeChild(el);
    }
    this.styleEl = null;
  }
}
