import { ScreenDetector } from './detector';
import { PinController } from './pin-controller';
import { HotkeyManager } from './hotkeys';
import { SwitcherHud } from './ui/hud';
import { ClassroomWall } from './ui/wall';
import { MockGenerator } from './mock-generator';
import { AnimationKiller } from './animation-killer';
import { AliasManager } from './alias-manager';
import { TileBadgeDecorator } from './ui/tile-badge';
import { SidePanelDecorator } from './ui/side-panel-decorator';
import { DiagnosticsLogger } from '../diagnostics/logger.ts';
import { CallMonitor } from '../diagnostics/call-monitor.ts';
import { GroupStore } from './attendance/group-store';
import { CallTitleDetector } from './attendance/title-detector';
import { AttendanceModal } from './ui/attendance-modal';
import { RosterDetector } from './attendance/roster-detector.ts';

// Prevent duplicate script execution
declare global {
  interface Window {
    __MEET_SWITCHER_INITIALIZED__?: boolean;
    __MEET_SWITCHER_LOGS__?: {
      download: () => void;
      getSession: () => any;
    };
    testPeoplePanel?: () => void;
    testPinParticipant?: (name: string) => Promise<boolean>;
  }
}

async function initMeetSwitcher(): Promise<void> {
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

  // Expose convenient test utilities directly on window
  window.testPeoplePanel = () => {
    console.log('=== [MeetSwitcher: People Panel Inspection] ===');
    const isOpen = controller.isPeoplePanelOpen();
    console.log('1. Панель відкрита:', isOpen ? 'ТАК ✅' : 'НІ ❌');

    const panel = document.querySelector(
      'div[role="tabpanel"], div[aria-label*="People" i], div[aria-label*="учасник" i], div[aria-label*="люди" i], aside'
    );
    if (!panel) {
      console.warn('Панель не знайдена в DOM. Відкрийте бічну панель "Учасники".');
      return;
    }

    const rows = Array.from(
      panel.querySelectorAll('div[role="listitem"], li[role="listitem"], div[data-participant-id]')
    );
    console.log('2. Знайдено рядків у списку:', rows.length);

    rows.forEach((row, i) => {
      const text = (row.textContent || '').replace(/\s+/g, ' ').trim();
      const buttons = Array.from(row.querySelectorAll('button, [role="button"]'));
      const btnInfo = buttons.map((b) => b.getAttribute('aria-label') || b.textContent?.trim() || 'кнопка');
      const isPres = /presentation|презентац|present_to_all|трансляц/i.test(text + ' ' + btnInfo.join(' '));
      console.log('Рядок ' + (i + 1) + (isPres ? ' [ПРЕЗЕНТАЦІЯ]: ' : ' [УЧЕНЬ]: ') + text.slice(0, 50));
      console.log('   Кнопки (' + buttons.length + '):', btnInfo);
    });
  };

  window.testPinParticipant = async (name: string) => {
    console.log('=== [MeetSwitcher: Тестове закріплення]', name, '===');
    const res = await controller.pinViaPeoplePanel(name);
    console.log('Результат закріплення для "' + name + '":', res ? 'УСПІШНО ✅' : 'НЕ ВДАЛОСЯ ❌');
    return res;
  };
  const hotkeys = new HotkeyManager(controller);
  const aliasManager = AliasManager.getInstance();
  await aliasManager.init();
  const tileDecorator = new TileBadgeDecorator(aliasManager);
  tileDecorator.start();
  const sidePanelDecorator = new SidePanelDecorator(aliasManager);
  sidePanelDecorator.start();

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
        // Give Google Meet time to transition from stage to full grid
        for (const delay of [250, 350, 500]) {
          await new Promise((r) => setTimeout(r, delay));
          detector.scan();
          if (wall.isOpen()) {
            refreshRosterState();
          }
        }
      }
      wall.open();
      refreshRosterState();
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

  const groupStore = GroupStore.getInstance();
  await groupStore.init();

  const titleDetector = new CallTitleDetector();
  const rosterDetector = new RosterDetector(detector);
  titleDetector.start();

  const attendanceModal = new AttendanceModal(hud.getShadowRoot(), groupStore);

  
  const refreshRosterState = () => {
    const shares = detector.getScreenShares();
    const activeNames = getActiveParticipantNames();
    const group = attendanceModal.getActiveGroup();
    const roster = rosterDetector.reconcileRoster(shares, activeNames, group ? group.students : undefined);
    
    hud.updateRoster(roster);
    if (wall.isOpen()) {
      wall.updateRoster(roster);
    }
  };
  
  hud.setOnRefreshRoster(() => {
    detector.scan(); // This will trigger onScan and onUpdate
    refreshRosterState();
  });


  const getActiveParticipantNames = (): string[] => {
    const names = new Set<string>();
    for (const s of detector.getScreenShares()) {
      if (s.participantName) names.add(s.participantName);
    }
    const addName = (t?: string | null) => {
      if (!t) return;
      // Use cast since cleanParticipantName/isValidParticipantName are private/public mixed
      const cleanFn = (detector as any).cleanParticipantName ? (detector as any).cleanParticipantName.bind(detector) : (s: string) => s;
      const validFn = (detector as any).isValidParticipantName ? (detector as any).isValidParticipantName.bind(detector) : () => true;
      const cleaned = cleanFn(t.trim());
      if (validFn(cleaned) && cleaned.length > 1) {
        names.add(cleaned);
      }
    };
    const tileNames = document.querySelectorAll('[data-participant-id] [data-self-name], [data-participant-id] span.notranslate');
    tileNames.forEach((el) => addName(el.textContent));
    
    const sidePanelNames = document.querySelectorAll('div[role="listitem"] span.zWGUib, div[role="listitem"] span.notranslate');
    sidePanelNames.forEach((el) => addName(el.textContent));
    
    return Array.from(names);
  };

  // Auto-match group when meeting title is detected
  titleDetector.onTitleChange(async (title) => {
    logger.log('SYSTEM', `Google Meet title detected: "${title}"`);
    const matched = await groupStore.findGroupByTitle(title);
    if (matched) {
      logger.log('SYSTEM', `Auto-matched LMS group: "${matched.name}" (ID: ${matched.id})`);
      attendanceModal.setSelectedGroup(matched.id);
    }
  });

  hud.setOnToggleAttendance(() => {
    if (attendanceModal.isOpen()) {
      attendanceModal.close();
    } else {
      attendanceModal.open();
      attendanceModal.update(getActiveParticipantNames());
    }
  });

  // Connect detector output to HUD, Wall, and Tile Badges
  detector.onUpdate((shares) => {
    if (shares.length > 0) {
      callMonitor.markMeetingJoined();
    }
    refreshRosterState();
    tileDecorator.updateBadges(shares);
  });

  // Keep badges and side panel alive across every DOM mutation / scan
  detector.onScan((shares) => {
    tileDecorator.updateBadges(shares);
    sidePanelDecorator.update();
    if (attendanceModal.isOpen()) {
      attendanceModal.update(getActiveParticipantNames());
    }
    refreshRosterState();
  });

  // Re-render video tile badges whenever aliases are added, edited, or removed
  aliasManager.onUpdate(() => {
    tileDecorator.updateBadges(detector.getScreenShares());
    sidePanelDecorator.update();
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
  document.addEventListener('DOMContentLoaded', () => {
    initMeetSwitcher().catch((err) => console.error('[MeetSwitcher] Init error:', err));
  });
} else {
  initMeetSwitcher().catch((err) => console.error('[MeetSwitcher] Init error:', err));
}

