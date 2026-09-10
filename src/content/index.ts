import { ScreenDetector } from './detector';
import { PinController } from './pin-controller';
import { HotkeyManager } from './hotkeys';
import { SwitcherHud } from './ui/hud';
import { ClassroomWall } from './ui/wall';
import { MockGenerator } from './mock-generator';

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
  const wall = new ClassroomWall(hud.getShadowRoot(), (share) => {
    controller.switchToShare(share);
  });
  const mockGen = new MockGenerator(detector);

  // Wire Classroom Wall toggling
  const toggleWall = () => {
    wall.toggle(detector.getScreenShares());
  };
  const closeWall = () => {
    wall.close();
  };

  // Wire Demo simulation toggling
  const toggleDemo = () => {
    const active = mockGen.toggle();
    hud.setDemoActive(active);
  };

  // Connect Wall & Demo to HUD and Hotkeys
  hud.setOnToggleWall(toggleWall);
  hud.setOnToggleDemo(toggleDemo);

  hotkeys.setOnToggleWall(toggleWall);
  hotkeys.setOnCloseWall(closeWall);
  hotkeys.setOnToggleDemo(toggleDemo);

  // Connect detector output to HUD and Wall
  detector.onUpdate((shares) => {
    hud.update(shares);
    if (wall.isOpen()) {
      wall.updateShares(shares);
    }
  });

  // Start background monitoring & keyboard shortcuts
  detector.start();
  hotkeys.start();

  console.log(
    '[MeetSwitcher] Ready! Shortcuts: Alt+1..9 to pin student, Alt+0/U to unpin, Alt+W for Classroom Wall, Alt+Shift+D for Demo.'
  );
}

// Initialize when DOM is interactive or complete
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMeetSwitcher);
} else {
  initMeetSwitcher();
}

