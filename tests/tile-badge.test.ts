import test from 'node:test';
import assert from 'node:assert/strict';
import { TileBadgeDecorator } from '../src/content/ui/tile-badge.ts';
import { AliasManager } from '../src/content/alias-manager.ts';
import type { ScreenShare } from '../src/types/index.ts';

test('TileBadgeDecorator directly rewrites native name element when alias exists', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Оксана Петренко', 'Максим');

  const decorator = new TileBadgeDecorator(aliasManager);

  // Mock native name element inside tile
  const nativeNameEl = {
    textContent: 'Оксана Петренко',
    innerHTML: 'Оксана Петренко',
    title: '',
    attributes: {} as Record<string, string>,
    getAttribute(name: string) { return this.attributes[name.toLowerCase()] || null; },
    setAttribute(name: string, val: string) { this.attributes[name.toLowerCase()] = val; },
    hasAttribute(name: string) { return Boolean(this.attributes[name.toLowerCase()]); },
    removeAttribute(name: string) { delete this.attributes[name.toLowerCase()]; },
  };

  const tile = {
    querySelector: (sel: string) => sel.includes('notranslate') ? nativeNameEl : null,
    appendChild: () => {},
    style: {} as any,
  } as any;

  const share: ScreenShare = {
    id: 'tile-1',
    index: 1,
    participantName: 'Оксана Петренко',
    isPinned: false,
    tileElement: tile,
  };

  decorator.updateTile(share);

  assert.equal(nativeNameEl.getAttribute('data-ms-original'), 'Оксана Петренко');
  assert.equal(nativeNameEl.innerHTML.includes('Максим'), true);
  assert.equal(nativeNameEl.innerHTML.includes('Оксана Петренко'), true);

  // When alias removed, should restore original name
  await aliasManager.removeAlias('Оксана Петренко');
  decorator.updateTile(share);

  assert.equal(nativeNameEl.textContent, 'Оксана Петренко');
  assert.equal(nativeNameEl.hasAttribute('data-ms-original'), false);
});

test('TileBadgeDecorator removes legacy badge when alias does not exist', () => {
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
