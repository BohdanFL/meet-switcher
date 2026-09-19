import test from 'node:test';
import assert from 'node:assert/strict';
import { RosterDetector } from '../src/content/attendance/roster-detector.ts';
import type { ScreenShare, GroupStudent } from '../src/types/index.ts';
import { ScreenDetector } from '../src/content/detector.ts';

test('RosterDetector reconciles classroom state correctly without a group', () => {
  const rosterDetector = new RosterDetector(new ScreenDetector());
  
  const shares: ScreenShare[] = [
    { id: '1', index: 1, participantName: 'Alice', isPinned: false, tileElement: null as any }
  ];
  const attendees = ['Alice', 'Bob', 'Charlie'];

  const state = rosterDetector.reconcileRoster(shares, attendees);

  assert.equal(state.activeSharers.length, 1);
  assert.equal(state.activeSharers[0].name, 'Alice');
  
  assert.equal(state.inCallNoScreen.length, 2);
  assert.ok(state.inCallNoScreen.find(p => p.name === 'Bob'));
  assert.ok(state.inCallNoScreen.find(p => p.name === 'Charlie'));
  
  assert.equal(state.absentStudents.length, 0);
  assert.equal(state.guests.length, 0);
});

test('RosterDetector reconciles classroom state with a group', () => {
  const detector = new ScreenDetector();
  const rosterDetector = new RosterDetector(detector);

  const groupStudents: GroupStudent[] = [
    { id: '101', fullName: 'Smith Alice', lmsUrl: '' },
    { id: '102', fullName: 'Johnson Bob', lmsUrl: '' },
    { id: '103', fullName: 'Williams Charlie', lmsUrl: '' },
    { id: '104', fullName: 'Brown David', lmsUrl: '' }
  ];

  // Alice shares screen, Bob is in call but no screen, Charlie is absent, Eve is a guest.
  const shares: ScreenShare[] = [
    { id: '1', index: 1, participantName: 'Alice', isPinned: false, tileElement: null as any }
  ];
  
  // Note: David is absent, Eve is a guest not in the LMS list
  const attendees = ['Alice', 'Bob', 'Eve'];

  const state = rosterDetector.reconcileRoster(shares, attendees, groupStudents);

  assert.equal(state.activeSharers.length, 1);
  assert.equal(state.activeSharers[0].name, 'Alice');
  assert.equal(state.activeSharers[0].category, 'ACTIVE_SCREEN');

  assert.equal(state.inCallNoScreen.length, 1);
  assert.equal(state.inCallNoScreen[0].name, 'Bob');
  assert.equal(state.inCallNoScreen[0].category, 'IN_CALL_NO_SCREEN');

  assert.equal(state.absentStudents.length, 2);
  assert.ok(state.absentStudents.find(s => s.name === 'Charlie'));
  assert.ok(state.absentStudents.find(s => s.name === 'David'));
  assert.equal(state.absentStudents[0].category, 'ABSENT');

  assert.equal(state.guests.length, 1);
  assert.equal(state.guests[0].name, 'Eve');
  assert.equal(state.guests[0].category, 'GUEST');
  assert.equal(state.guests[0].isGuest, true);
});
