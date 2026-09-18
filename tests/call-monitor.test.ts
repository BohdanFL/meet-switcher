import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLeaveButtonLabel,
  isMeetingEndedText,
  isUserInMeeting,
  CallMonitor,
} from '../src/diagnostics/call-monitor.ts';
import { DiagnosticsLogger } from '../src/diagnostics/logger.ts';

test('isLeaveButtonLabel matches English and Ukrainian labels', () => {
  assert.equal(isLeaveButtonLabel('Leave call'), true);
  assert.equal(isLeaveButtonLabel('Покинути дзвінок'), true);
  assert.equal(isLeaveButtonLabel('Залишити виклик'), true);
  assert.equal(isLeaveButtonLabel('Завершити дзвінок'), true);
  assert.equal(isLeaveButtonLabel('Завершить звонок'), true);
  assert.equal(isLeaveButtonLabel('Turn off microphone'), false);
  assert.equal(isLeaveButtonLabel('Pin presentation'), false);
});

test('isMeetingEndedText identifies Meet post-call screen indicators', () => {
  assert.equal(isMeetingEndedText('You left the meeting'), true);
  assert.equal(isMeetingEndedText('Ви залишили зустріч'), true);
  assert.equal(isMeetingEndedText('Зустріч завершилася'), true);
  assert.equal(isMeetingEndedText('Ви вийшли з виклику'), true);
  assert.equal(isMeetingEndedText('Welcome to Google Meet'), false);
  assert.equal(isMeetingEndedText('Alex is presenting'), false);
});

// Mock minimal DOM document for Node environment
function createMockDoc(options: {
  buttons?: Array<{ ariaLabel?: string; dataTooltip?: string; textContent?: string }>;
  selectors?: string[];
  bodyText?: string;
}) {
  const buttons = (options.buttons || []).map((b) => ({
    tagName: 'BUTTON',
    getAttribute: (attr: string) => {
      if (attr === 'aria-label') return b.ariaLabel || null;
      if (attr === 'data-tooltip') return b.dataTooltip || null;
      return null;
    },
    textContent: b.textContent || '',
    closest: () => null,
  }));

  const selectorsSet = new Set(options.selectors || []);

  return {
    body: {
      innerText: options.bodyText || '',
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('button')) return buttons;
      return [];
    },
    querySelector: (sel: string) => {
      for (const s of selectorsSet) {
        if (sel.includes(s)) return { tagName: 'DIV' };
      }
      return null;
    },
  } as any;
}

test('isUserInMeeting returns false for lobby / pre-join screen with join button only', () => {
  const doc = createMockDoc({
    buttons: [
      { ariaLabel: 'Turn off microphone' },
      { ariaLabel: 'Turn off camera' },
      { textContent: 'Join now' },
    ],
  });
  assert.equal(isUserInMeeting(doc), false);
});

test('isUserInMeeting returns true when leave button exists in DOM', () => {
  const doc = createMockDoc({
    buttons: [
      { ariaLabel: 'Leave call' },
    ],
  });
  assert.equal(isUserInMeeting(doc), true);
});

test('isUserInMeeting returns true when participant tiles or meeting title exist', () => {
  const docWithTitle = createMockDoc({
    selectors: ['[data-meeting-title]'],
  });
  assert.equal(isUserInMeeting(docWithTitle), true);

  const docWithTiles = createMockDoc({
    selectors: ['[data-participant-id]'],
  });
  assert.equal(isUserInMeeting(docWithTiles), true);
});

test('CallMonitor does not auto-export on tab_closed if meeting was never joined', () => {
  const logger = new DiagnosticsLogger({ enableStorageSync: false });
  const monitor = new CallMonitor(logger);

  let exported = false;
  // Intercept triggerAutoExport
  const origTrigger = monitor.triggerAutoExport.bind(monitor);
  monitor.triggerAutoExport = (reason: string, force = false) => {
    origTrigger(reason, force);
    exported = monitor.getHasExported();
  };

  assert.equal(monitor.isInMeeting(), false);
  // Attempt to export due to tab_closed
  monitor.triggerAutoExport('tab_closed');

  assert.equal(exported, false);
  assert.equal(monitor.getHasExported(), false);
});

test('CallMonitor auto-exports on tab_closed if meeting was joined', () => {
  const logger = new DiagnosticsLogger({ enableStorageSync: false });
  const monitor = new CallMonitor(logger);

  monitor.markMeetingJoined();
  assert.equal(monitor.isInMeeting(), true);

  monitor.triggerAutoExport('tab_closed');
  assert.equal(monitor.getHasExported(), true);
});

