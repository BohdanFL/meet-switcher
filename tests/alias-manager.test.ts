import test from 'node:test';
import assert from 'node:assert/strict';
import { AliasManager } from '../src/content/alias-manager.ts';

test('AliasManager normalizes names correctly', () => {
  const manager = new AliasManager({ enableStorageSync: false });
  assert.equal(manager.normalizeName('  Оксана Петренко  '), 'оксана петренко');
  assert.equal(manager.normalizeName('Оксана Петренко (презентація)'), 'оксана петренко');
  assert.equal(manager.normalizeName("John Doe's presentation"), 'john doe');
});

test('AliasManager formats display name with combined format', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Оксана Петренко');

  await manager.setAlias('Оксана Петренко', 'Максим');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Максим (Оксана Петренко)');
  assert.equal(manager.getAlias('Оксана Петренко'), 'Максим');
});

test('AliasManager removes alias when empty string is set', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Максим (Оксана Петренко)');

  await manager.removeAlias('Оксана Петренко');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Оксана Петренко');
  assert.equal(manager.getAlias('Оксана Петренко'), null);
});

test('AliasManager exports and imports aliases JSON', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим');
  await manager.setAlias('Ігор Коваль', 'Данило');

  const json = manager.exportAliasesJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 2);

  const manager2 = new AliasManager({ enableStorageSync: false });
  const importedCount = await manager2.importAliases(parsed);
  assert.equal(importedCount, 2);
  assert.equal(manager2.formatDisplayName('Ігор Коваль'), 'Данило (Ігор Коваль)');
});
