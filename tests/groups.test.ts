import test from 'node:test';
import assert from 'node:assert/strict';
import { AliasManager } from '../src/content/alias-manager.ts';
import type { StudentAliasEntry } from '../src/types/alias.ts';

test('AliasManager stores and retrieves student group', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  assert.equal(manager.getStudentGroup('Оксана Петренко'), null);

  await manager.setAlias('Оксана Петренко', 'Максим', '5-А клас');
  assert.equal(manager.getAlias('Оксана Петренко'), 'Максим');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), '5-А клас');
});

test('AliasManager preserves group when only alias is updated', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим', 'Python Субота');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), 'Python Субота');

  // Update alias name without passing group argument -> should retain existing group
  await manager.setAlias('Оксана Петренко', 'Макс');
  assert.equal(manager.getAlias('Оксана Петренко'), 'Макс');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), 'Python Субота');

  // Explicitly update group
  await manager.setAlias('Оксана Петренко', 'Макс', 'Python Просунутий');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), 'Python Просунутий');

  // Explicitly clear group by passing empty string
  await manager.setAlias('Оксана Петренко', 'Макс', '');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), null);
});

test('AliasManager exports and imports aliases JSON with group attribute', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим', 'Група 1');
  await manager.setAlias('Ігор Коваль', 'Данило'); // No group

  const json = manager.exportAliasesJson();
  const parsed = JSON.parse(json) as StudentAliasEntry[];

  const petrenko = parsed.find((p) => p.alias === 'Максим');
  assert.ok(petrenko);
  assert.equal(petrenko.group, 'Група 1');

  const koval = parsed.find((p) => p.alias === 'Данило');
  assert.ok(koval);
  assert.equal(koval.group, undefined);

  // Import into new instance
  const manager2 = new AliasManager({ enableStorageSync: false });
  const importedCount = await manager2.importAliases(parsed);
  assert.equal(importedCount, 2);
  assert.equal(manager2.getStudentGroup('Оксана Петренко'), 'Група 1');
  assert.equal(manager2.getStudentGroup('Ігор Коваль'), null);
});

test('Legacy import without group backwards-compatibility', async () => {
  const legacyData = [
    {
      key: 'оксана петренко',
      originalName: 'Оксана Петренко',
      alias: 'Максим',
      updatedAt: 123456789,
    },
  ];

  const manager = new AliasManager({ enableStorageSync: false });
  const count = await manager.importAliases(legacyData as any);
  assert.equal(count, 1);
  assert.equal(manager.getAlias('Оксана Петренко'), 'Максим');
  assert.equal(manager.getStudentGroup('Оксана Петренко'), null);
});

test('Group rename logic updates student records in map', () => {
  const map: Record<string, StudentAliasEntry> = {
    'student-1': {
      key: 'student-1',
      originalName: 'Parent 1',
      alias: 'Child 1',
      group: 'Old Group',
      updatedAt: 1000,
    },
    'student-2': {
      key: 'student-2',
      originalName: 'Parent 2',
      alias: 'Child 2',
      group: 'Other Group',
      updatedAt: 1000,
    },
  };

  const oldName = 'Old Group';
  const newName = 'New Group';

  for (const item of Object.values(map)) {
    if (item.group === oldName) {
      item.group = newName;
      item.updatedAt = 2000;
    }
  }

  assert.equal(map['student-1'].group, 'New Group');
  assert.equal(map['student-1'].updatedAt, 2000);
  assert.equal(map['student-2'].group, 'Other Group');
});

test('Group deletion unassigns students to undefined without removing student entry', () => {
  const map: Record<string, StudentAliasEntry> = {
    'student-1': {
      key: 'student-1',
      originalName: 'Parent 1',
      alias: 'Child 1',
      group: 'To Delete',
      updatedAt: 1000,
    },
  };

  for (const item of Object.values(map)) {
    if (item.group === 'To Delete') {
      delete item.group;
      item.updatedAt = 2000;
    }
  }

  assert.ok(map['student-1']);
  assert.equal(map['student-1'].alias, 'Child 1');
  assert.equal(map['student-1'].group, undefined);
  assert.equal(map['student-1'].updatedAt, 2000);
});
