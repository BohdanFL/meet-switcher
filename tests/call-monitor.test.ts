import test from 'node:test';
import assert from 'node:assert/strict';
import { isLeaveButtonLabel, isMeetingEndedText } from '../src/diagnostics/call-monitor.ts';

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
