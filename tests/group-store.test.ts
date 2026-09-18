import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupStore } from '../src/content/attendance/group-store.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

test('GroupStore saves and retrieves student groups from in-memory / storage fallback', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  
  const sampleGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601#group-student-grid',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };

  await store.saveGroup(sampleGroup);
  const fetched = await store.getGroup('2595601');
  assert.ok(fetched);
  assert.equal(fetched.name, 'УКР_Гейм_ЧТ_19:00');
  assert.equal(fetched.students.length, 2);
});

test('GroupStore finds group by Google Meet call title (fuzzy & exact)', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [],
  });

  // Exact match
  const exact = await store.findGroupByTitle('УКР_Гейм_ЧТ_19:00');
  assert.ok(exact);
  assert.equal(exact.id, '2595601');

  // Whitespace and case tolerance
  const normalized = await store.findGroupByTitle('  укр_гейм_чт_19:00 ');
  assert.ok(normalized);
  assert.equal(normalized.id, '2595601');

  // Match by group ID in title if title contains it
  const byId = await store.findGroupByTitle('Meeting 2595601 Call');
  assert.ok(byId);
  assert.equal(byId.id, '2595601');

  // Non-matching title returns null
  const none = await store.findGroupByTitle('Some Other Call');
  assert.equal(none, null);
});

test('GroupStore pairs and unpairs Google Meet participant name to LMS student', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
    ],
  });

  await store.pairStudent('2595601', '6753930', 'Iryna Alfeldi', 'Камалія');
  const group = await store.getGroup('2595601');
  assert.ok(group);
  assert.equal(group.students[0].meetOriginalName, 'Iryna Alfeldi');
  assert.equal(group.students[0].shortAlias, 'Камалія');

  await store.unpairStudent('2595601', '6753930');
  const unpairedGroup = await store.getGroup('2595601');
  assert.ok(unpairedGroup);
  assert.equal(unpairedGroup.students[0].meetOriginalName, undefined);
  assert.equal(unpairedGroup.students[0].shortAlias, undefined);
});

test('GroupStore merges new import preserving existing pairings', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: 1000,
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
        meetOriginalName: 'Iryna Alfeldi',
        shortAlias: 'Камалія',
      },
    ],
  });

  // Re-importing with an additional student
  const updatedGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00 (Оновлена)',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: 2000,
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };

  await store.saveGroup(updatedGroup);
  const result = await store.getGroup('2595601');
  assert.ok(result);
  assert.equal(result.students.length, 2);
  // Pairing preserved!
  assert.equal(result.students[0].meetOriginalName, 'Iryna Alfeldi');
  assert.equal(result.students[0].shortAlias, 'Камалія');
});
