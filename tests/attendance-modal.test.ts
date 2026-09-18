import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceModal } from '../src/content/ui/attendance-modal.ts';
import { GroupStore } from '../src/content/attendance/group-store.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

test('AttendanceModal renders groups, stats, and student rows', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  const sampleGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
        meetOriginalName: 'Iryna Alfeldi',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };
  await store.saveGroup(sampleGroup);

  // Mock ShadowRoot host
  const children: any[] = [];
  const mockShadow = {
    appendChild: (child: any) => children.push(child),
    querySelector: () => null,
  } as any;

  const modal = new AttendanceModal(mockShadow, store);
  assert.equal(modal.isOpen(), false);

  modal.open(sampleGroup);
  assert.equal(modal.isOpen(), true);

  modal.update(['Iryna Alfeldi']);
  modal.close();
  assert.equal(modal.isOpen(), false);
});
