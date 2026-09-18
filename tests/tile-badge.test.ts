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

// Mock minimal DOM Element for Google Meet Real Tile structures
class MockTileElement {
  public tagName: string;
  public textContent: string;
  public innerHTML: string;
  public className: string;
  public title: string = '';
  public attributes: Record<string, string> = {};
  public children: MockTileElement[] = [];
  public parentElement: MockTileElement | null = null;
  public style: Record<string, string> = {};

  constructor(tagName: string, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.innerHTML = textContent;
    this.className = '';
  }

  setAttribute(name: string, value: string) {
    this.attributes[name.toLowerCase()] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] || null;
  }

  hasAttribute(name: string): boolean {
    return Boolean(this.attributes[name.toLowerCase()]);
  }

  removeAttribute(name: string) {
    delete this.attributes[name.toLowerCase()];
  }

  appendChild(child: MockTileElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  closest(selector: string): MockTileElement | null {
    if (selector.includes('data-is-tooltip-wrapper') && this.hasAttribute('data-is-tooltip-wrapper')) {
      return this;
    }
    if (this.parentElement) {
      return this.parentElement.closest(selector);
    }
    return null;
  }

  querySelector(selector: string): MockTileElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockTileElement[] {
    const results: MockTileElement[] = [];
    const parts = selector.split(',').map((s) => s.trim());
    const traverse = (el: MockTileElement) => {
      for (const child of el.children) {
        const matches = parts.some((p) => {
          if (p.startsWith('.') && child.className.includes(p.slice(1))) return true;
          if (p.includes('.notranslate') && child.className.includes('notranslate')) return true;
          if (p.includes('.ms-alias-name') && child.className.includes('ms-alias-name')) return true;
          if (p === 'span' && child.tagName === 'SPAN') return true;
          if (p.includes('role="tooltip"') && child.getAttribute('role') === 'tooltip') return true;
          return false;
        });
        if (matches) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  addEventListener() {}
}

test('TileBadgeDecorator decorates presentation tile matching user Snippet 1 and recovers from Wiz re-render', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Богдан77');

  const decorator = new TileBadgeDecorator(aliasManager);

  // Build Snippet 1 structure:
  // div.ZY8hPc -> div.Djiqwe -> div.LqxiJe -> div.Ncfvpd -> div.OFfHfd -> div.XEazBc -> span.notranslate
  const root = new MockTileElement('div');
  const xeazbc = new MockTileElement('div');
  xeazbc.className = 'XEazBc adnwBd';

  const tooltipWrapper = new MockTileElement('span');
  tooltipWrapper.setAttribute('data-is-tooltip-wrapper', 'true');

  const nameSpan = new MockTileElement('span', 'Bohdan Rubakha (Presentation)');
  nameSpan.className = 'notranslate';
  tooltipWrapper.appendChild(nameSpan);

  const tooltip = new MockTileElement('div', 'Bohdan Rubakha (Presentation)');
  tooltip.setAttribute('role', 'tooltip');
  tooltipWrapper.appendChild(tooltip);

  xeazbc.appendChild(tooltipWrapper);
  root.appendChild(xeazbc);

  // 1. Initial decoration
  decorator.updateAll(root as any);

  assert.equal(nameSpan.getAttribute('data-ms-original'), 'Bohdan Rubakha');
  assert.equal(nameSpan.innerHTML.includes('Богдан77'), true);
  assert.equal(nameSpan.innerHTML.includes('Bohdan Rubakha'), true);
  assert.equal(nameSpan.innerHTML.includes('презентація'), true);
  assert.equal(tooltip.textContent.includes('Богдан77'), true);

  // 2. Simulate Google Meet Wiz framework resetting innerHTML to text while keeping data-ms-formatted
  nameSpan.innerHTML = 'Bohdan Rubakha (Presentation)';
  nameSpan.children = []; // wiped out .ms-alias-name

  // Next scan must detect missing .ms-alias-name and self-heal!
  decorator.updateAll(root as any);

  assert.equal(nameSpan.innerHTML.includes('Богдан77'), true, 'Should restore alias after Wiz DOM overwrite');
  assert.equal(nameSpan.innerHTML.includes('презентація'), true);
});

test('TileBadgeDecorator decorates regular participant webcam/avatar tile matching user Snippet 2', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Богдан77');

  const decorator = new TileBadgeDecorator(aliasManager);

  // Build Snippet 2 structure:
  const root = new MockTileElement('div');
  const xeazbc = new MockTileElement('div');
  xeazbc.className = 'XEazBc adnwBd';

  const tooltipWrapper = new MockTileElement('span');
  tooltipWrapper.setAttribute('data-is-tooltip-wrapper', 'true');

  const nameSpan = new MockTileElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'notranslate';
  tooltipWrapper.appendChild(nameSpan);

  xeazbc.appendChild(tooltipWrapper);
  root.appendChild(xeazbc);

  decorator.updateAll(root as any);

  assert.equal(nameSpan.getAttribute('data-ms-original'), 'Bohdan Rubakha');
  assert.equal(nameSpan.innerHTML.includes('Богдан77'), true);
  assert.equal(nameSpan.innerHTML.includes('Bohdan Rubakha'), true);
  // Participant tile without presentation should NOT have presentation tag
  assert.equal(nameSpan.innerHTML.includes('презентація'), false);

  // 3. Alias removal restores clean original name
  await aliasManager.removeAlias('Bohdan Rubakha');
  decorator.updateAll(root as any);

  assert.equal(nameSpan.textContent, 'Bohdan Rubakha');
  assert.equal(nameSpan.hasAttribute('data-ms-original'), false);
  assert.equal(nameSpan.hasAttribute('data-ms-formatted'), false);
});

