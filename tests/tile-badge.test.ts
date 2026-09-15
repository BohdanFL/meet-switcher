import test from 'node:test';
import assert from 'node:assert/strict';
import { TileBadgeDecorator } from '../src/content/ui/tile-badge.ts';
import { AliasManager } from '../src/content/alias-manager.ts';
import type { ScreenShare } from '../src/types/index.ts';

test('TileBadgeDecorator mounts badge on tile when alias exists', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Оксана Петренко', 'Максим');

  const decorator = new TileBadgeDecorator(aliasManager);

  // Mock DOM elements
  const tile = {
    querySelector: () => null,
    appendChild: (el: any) => { (tile as any)._child = el; },
    style: {} as any,
    _child: null as any,
  } as any;

  const shares: ScreenShare[] = [
    {
      id: 'tile-1',
      index: 1,
      participantName: 'Оксана Петренко',
      isPinned: false,
      tileElement: tile,
    },
  ];

  decorator.updateTile(shares[0]);
  assert.ok(tile._child);
  assert.equal(tile._child.textContent, '🏷️ Максим (Оксана Петренко)');
});

test('TileBadgeDecorator removes badge when alias does not exist', () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  const decorator = new TileBadgeDecorator(aliasManager);

  let removed = false;
  const existingBadge = {
    remove: () => { removed = true; },
  };

  const tile = {
    querySelector: (sel: string) => sel.includes('meet-switcher-student-badge') ? existingBadge : null,
    appendChild: () => {},
    style: {} as any,
  } as any;

  const share: ScreenShare = {
    id: 'tile-2',
    index: 2,
    participantName: 'Сергій Іванов',
    isPinned: false,
    tileElement: tile,
  };

  decorator.updateTile(share);
  assert.equal(removed, true);
});
