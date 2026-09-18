import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceTracker } from '../src/content/attendance/attendance-tracker.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

const mockGroup: StudentGroup = {
  id: '2595601',
  name: 'УКР_Гейм_ЧТ_19:00',
  lmsUrl: 'https://lms.alg.academy/group/view/2595601#group-student-grid',
  updatedAt: Date.now(),
  students: [
    {
      id: '6753930',
      fullName: 'Альфелді Камалія',
      lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      meetOriginalName: 'Iryna Alfeldi',
      shortAlias: 'Камалія',
    },
    {
      id: '6753283',
      fullName: 'Воронченко Віра',
      lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      meetOriginalName: 'Vira Voronchenko',
      shortAlias: 'Віра',
    },
    {
      id: '6751389',
      fullName: 'Євтушенко Ярослав',
      lmsUrl: 'https://lms.alg.academy/student/update/6751389',
      // No Meet binding yet
    },
  ],
};

test('AttendanceTracker correctly marks present students by meetOriginalName or alias', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi', 'Teacher Name'];

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  
  const kamaliya = items.find((i) => i.student.id === '6753930');
  assert.ok(kamaliya);
  assert.equal(kamaliya.isPresent, true);

  const vira = items.find((i) => i.student.id === '6753283');
  assert.ok(vira);
  assert.equal(vira.isPresent, false);

  const yaroslav = items.find((i) => i.student.id === '6751389');
  assert.ok(yaroslav);
  assert.equal(yaroslav.isPresent, false);
});

test('AttendanceTracker respects manual override over automatic detection', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi'];

  // Manually mark Yaroslav as present
  tracker.setManualOverride('6751389', true);

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  const yaroslav = items.find((i) => i.student.id === '6751389');
  assert.ok(yaroslav);
  assert.equal(yaroslav.isPresent, true);
  assert.equal(yaroslav.isManualOverride, true);

  // Clear manual override
  tracker.setManualOverride('6751389', null);
  const recomputed = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  assert.equal(recomputed.find((i) => i.student.id === '6751389')?.isPresent, false);
});

test('AttendanceTracker formats manager report strictly matching spec format', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi', 'Vira Voronchenko'];

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  const report = tracker.formatManagerReport(mockGroup, items);

  const expectedLines = [
    'Альфелді Камалія (https://lms.alg.academy/student/update/6753930) (Iryna Alfeldi) +',
    'Воронченко Віра (https://lms.alg.academy/student/update/6753283) (Vira Voronchenko) +',
    'Євтушенко Ярослав (https://lms.alg.academy/student/update/6751389) (не прив\'язано) -',
  ];

  assert.equal(report, expectedLines.join('\n'));
});
