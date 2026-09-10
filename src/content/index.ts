import { ScreenDetector } from './detector';
import { PinController } from './pin-controller';
import { HotkeyManager } from './hotkeys';
import { SwitcherHud } from './ui/hud';

// Prevent duplicate script execution
declare global {
  interface Window {
    __MEET_SWITCHER_INITIALIZED__?: boolean;
  }
}

function initMeetSwitcher(): void {
  if (window.__MEET_SWITCHER_INITIALIZED__) {
    return;
  }
  window.__MEET_SWITCHER_INITIALIZED__ = true;

  console.log('[MeetSwitcher] Initializing Google Meet screen switcher extension...');

  const detector = new ScreenDetector();
  const controller = new PinController(detector);
  const hotkeys = new HotkeyManager(controller);
  const hud = new SwitcherHud(controller);

  // Connect detector output to HUD
  detector.onUpdate((shares) => {
    hud.update(shares);
  });

  // Start background monitoring & keyboard shortcuts
  detector.start();
  hotkeys.start();

  console.log('[MeetSwitcher] Ready! Shortcuts: Alt+1..9 to pin student, Alt+Left/Right to cycle.');
}

// Initialize when DOM is interactive or complete
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMeetSwitcher);
} else {
  initMeetSwitcher();
}
