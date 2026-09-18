import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsLogger } from '../src/diagnostics/logger.ts';

test('DiagnosticsLogger creates session and records events', () => {
  const logger = new DiagnosticsLogger({ maxEvents: 10, enableStorageSync: false });
  logger.log('SYSTEM', 'Logger initialized');
  logger.log('SCAN', 'DOM scanned', { videoCount: 4 });

  const events = logger.getEvents();
  assert.equal(events.length, 2);
  assert.equal(events[0].category, 'SYSTEM');
  assert.equal(events[0].message, 'Logger initialized');
  assert.equal(events[1].category, 'SCAN');
  assert.equal(events[1].details?.videoCount, 4);
});

test('DiagnosticsLogger ring buffer caps at maxEvents', () => {
  const logger = new DiagnosticsLogger({ maxEvents: 5, enableStorageSync: false });
  for (let i = 1; i <= 10; i++) {
    logger.log('ACTION', `Event ${i}`);
  }

  const events = logger.getEvents();
  assert.equal(events.length, 5);
  assert.equal(events[0].message, 'Event 6');
  assert.equal(events[4].message, 'Event 10');
});

test('DiagnosticsLogger exports valid session JSON with statistics', () => {
  const logger = new DiagnosticsLogger({ maxEvents: 50, enableStorageSync: false });
  logger.recordSwitch('Alex', 1, true);
  logger.recordSwitch('Maria', 2, false);
  logger.recordParticipantFound('Alex');
  logger.recordParticipantFound('Maria');
  logger.log('ERROR', 'Pin button missing on tile');

  const jsonStr = logger.exportSessionJson();
  const data = JSON.parse(jsonStr);

  assert.ok(data.id);
  assert.equal(data.totalSwitches, 2);
  assert.equal(data.errorCount, 1);
  assert.deepEqual(data.detectedParticipants, ['Alex', 'Maria']);
  assert.equal(data.events.length, 5);
});

test('DiagnosticsLogger tracks meeting joined state and guards persistToStorage', async () => {
  let storedData: any = null;
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async () => ({ meet_switcher_diagnostic_sessions: [] }),
        set: async (val: any) => {
          storedData = val;
        },
      },
    },
  };

  const logger = new DiagnosticsLogger({ enableStorageSync: true });
  assert.equal(logger.isMeetingJoined(), false);

  // Attempting persist when meeting not joined should do nothing
  await logger.persistToStorage();
  assert.equal(storedData, null);

  // Mark joined and try again
  logger.setMeetingJoined(true);
  assert.equal(logger.isMeetingJoined(), true);
  await logger.persistToStorage();
  assert.ok(storedData?.meet_switcher_diagnostic_sessions);
  assert.equal(storedData.meet_switcher_diagnostic_sessions.length, 1);

  logger.endSession();
  delete (globalThis as any).chrome;
});

