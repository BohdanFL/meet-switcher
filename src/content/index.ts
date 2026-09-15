import { ScreenDetector } from './detector';
import { PinController } from './pin-controller';
import { HotkeyManager } from './hotkeys';
import { SwitcherHud } from './ui/hud';
import { ClassroomWall } from './ui/wall';
import { MockGenerator } from './mock-generator';
import { AnimationKiller } from './animation-killer';
import { AliasManager } from './alias-manager';
import { TileBadgeDecorator } from './ui/tile-badge';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import { CallMonitor } from '../diagnostics/call-monitor.ts';

// Prevent duplicate script execution
declare global {
  interface Window {
    __MEET_SWITCHER_INITIALIZED__?: boolean;
    __MEET_SWITCHER_LOGS__?: {
      download: () => void;
      getSession: () => any;
    };
  }
}

function initMeetSwitcher(): void {
  if (window.__MEET_SWITCHER_INITIALIZED__) {
    return;
  }
  window.__MEET_SWITCHER_INITIALIZED__ = true;

  const logger = DiagnosticsLogger.getInstance();
  const callMonitor = new CallMonitor(logger);
  callMonitor.start();

  // Expose DevTools console utility
  window.__MEET_SWITCHER_LOGS__ = {
    download: () => callMonitor.triggerAutoExport('manual_console_trigger'),
    getSession: () => logger.getSession(),
  };

  logger.log('SYSTEM', 'Initializing Google Meet screen switcher extension...');

  const animKiller = new AnimationKiller();
  const detector = new ScreenDetector();
  const controller = new PinController(detector, animKiller);
  const hotkeys = new HotkeyManager(controller);
  const aliasManager = AliasManager.getInstance();
  aliasManager.init();
  const tileDecorator = new TileBadgeDecorator(aliasManager);
  const hud = new SwitcherHud(controller);
  const wall = new ClassroomWall(hud.getShadowRoot(), (share) => {
    controller.switchToShare(share);
  });
  const mockGen = new MockGenerator(detector);

  // Sync initial turbo mode state
  hud.setTurboActive(animKiller.isAnimationDisabled());

  // Wire Classroom Wall toggling
  const toggleWall = async () => {
    if (!wall.isOpen()) {
      if (detector.isAnyStreamPinned()) {
        console.log('[MeetSwitcher] Unpinning to expand full grid for Classroom Wall...');
        await controller.unpin();
        await new Promise((r) => setTimeout(r, 100));
        detector.scan();
      }
      wall.open(detector.getScreenShares());
    } else {
      wall.close();
    }
  };
  const closeWall = () => {
    wall.close();
  };

  // Wire Demo simulation toggling
  const toggleDemo = () => {
    const active = mockGen.toggle();
    hud.setDemoActive(active);
  };

  // Wire Turbo Mode (Google Meet animations killer)
  const toggleTurbo = () => {
    const disabled = animKiller.toggle();
    hud.setTurboActive(disabled);
  };

  // Connect Wall, Demo & Turbo to HUD and Hotkeys
  hud.setOnToggleWall(toggleWall);
  hud.setOnToggleDemo(toggleDemo);
  hud.setOnToggleTurbo(toggleTurbo);

  wall.setOnToggleDemo(toggleDemo);

  hotkeys.setOnToggleWall(toggleWall);
  hotkeys.setOnCloseWall(closeWall);
  hotkeys.setOnToggleDemo(toggleDemo);
  hotkeys.setOnToggleTurbo(toggleTurbo);

  // Connect detector output to HUD, Wall, and Tile Badges
  detector.onUpdate((shares) => {
    hud.update(shares);
    if (wall.isOpen()) {
      wall.updateShares(shares);
    }
    tileDecorator.updateBadges(shares);
  });

  // Re-render video tile badges whenever aliases are added, edited, or removed
  aliasManager.onUpdate(() => {
    tileDecorator.updateBadges(detector.getScreenShares());
  });

  // Load and apply Demo visibility setting
  try {
    chrome.storage?.local?.get('meet_switcher_show_demo', (res) => {
      const showDemo = Boolean(res?.meet_switcher_show_demo);
      hud.setShowDemo(showDemo);
      wall.setShowDemo(showDemo);
      hotkeys.setDemoEnabled(showDemo);
    });
  } catch (err) {
    console.warn('[MeetSwitcher] Failed to read demo setting:', err);
  }

  // React to settings changes in real time
  try {
    chrome.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName === 'local' && changes['meet_switcher_show_demo']) {
        const showDemo = Boolean(changes['meet_switcher_show_demo'].newValue);
        hud.setShowDemo(showDemo);
        wall.setShowDemo(showDemo);
        hotkeys.setDemoEnabled(showDemo);
      }
    });
  } catch (err) {
    console.warn('[MeetSwitcher] Failed to attach storage listener:', err);
  }

  // Start background monitoring & keyboard shortcuts
  detector.start();
  hotkeys.start();

  console.log(
    '[MeetSwitcher] Ready! Shortcuts: Alt+1..9 to pin student, Alt+0/U to unpin, Alt+W for Classroom Wall, Alt+A for Turbo Mode, Alt+Shift+D for Demo.'
  );
}

// Initialize when DOM is interactive or complete
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMeetSwitcher);
} else {
  initMeetSwitcher();
}

