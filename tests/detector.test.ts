import test from 'node:test';
import assert from 'node:assert/strict';

// Helper to mock minimal DOM Element
class MockElement {
  public tagName: string;
  public textContent: string;
  public className: string;
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public classList = {
    contains: (cls: string) => this.className.split(/\s+/).includes(cls),
  };

  constructor(tagName: string, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.className = '';
  }

  setAttribute(name: string, value: string) {
    this.attributes[name.toLowerCase()] = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name.toLowerCase()] || null;
  }

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        if (selector === 'button' && child.tagName === 'BUTTON') {
          results.push(child);
        } else if (selector.includes('span') && child.tagName === 'SPAN') {
          results.push(child);
        } else if (selector.includes('div') && child.tagName === 'DIV') {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.includes('mock-student-tile') && curr.classList.contains('mock-student-tile')) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }
}

// Logic to test: Menu option selection for Host Pin
function selectHostPinOption(items: Array<{ text: string; aria?: string }>): number {
  const forMyselfRegex = /(?:myself|for me|мене|себе|себя)/i;
  const forEveryoneRegex = /(?:everyone|all|всіх|всех)/i;

  // 1. Direct match for "myself" / "Лише для мене"
  for (let i = 0; i < items.length; i++) {
    const text = (items[i].text || '').trim().toLowerCase();
    const aria = (items[i].aria || '').trim().toLowerCase();

    if (
      (forMyselfRegex.test(text) || forMyselfRegex.test(aria)) &&
      !forEveryoneRegex.test(text) &&
      !forEveryoneRegex.test(aria)
    ) {
      return i;
    }
  }

  // 2. Safe fallback: pick the one that is NOT for everyone
  for (let i = 0; i < items.length; i++) {
    const text = (items[i].text || '').trim().toLowerCase();
    const aria = (items[i].aria || '').trim().toLowerCase();
    if (!forEveryoneRegex.test(text) && !forEveryoneRegex.test(aria)) {
      return i;
    }
  }

  return -1; // Never click "everyone"
}

// Logic to test: isPresentationTile
function isPresentationTileCheck(tile: MockElement): boolean {
  if (tile.classList.contains('mock-student-tile') || tile.closest('.mock-student-tile')) {
    return true;
  }

  const textContent = tile.textContent || '';

  // 1. Icon checks (specific to screen sharing)
  if (
    textContent.includes('present_to_all') ||
    textContent.includes('screen_share') ||
    textContent.includes('co_present') ||
    textContent.includes('desktop_windows')
  ) {
    return true;
  }

  // 2. Button aria-labels / tooltips check
  const buttons = tile.querySelectorAll('button');
  for (const btn of buttons) {
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();

    if (
      label.includes('presentation') ||
      label.includes('презентац') ||
      label.includes('screen share') ||
      label.includes('показ екран') ||
      label.includes('демонстрац') ||
      tooltip.includes('presentation') ||
      tooltip.includes('презентац') ||
      tooltip.includes('screen share') ||
      tooltip.includes('показ екран') ||
      tooltip.includes('демонстрац')
    ) {
      return true;
    }
  }

  // 3. Tile attribute checks
  const tileAttrs = (
    tile.getAttribute('aria-label') ||
    tile.getAttribute('data-tile-type') ||
    tile.getAttribute('data-stream-type') ||
    ''
  ).toLowerCase();

  if (
    tileAttrs.includes('presentation') ||
    tileAttrs.includes('презентац') ||
    tileAttrs.includes('screen share') ||
    tileAttrs.includes('показ екран') ||
    tileAttrs.includes('демонстрац')
  ) {
    return true;
  }

  // 4. Text badge checks
  const badges = [...tile.querySelectorAll('span'), ...tile.querySelectorAll('div')];
  for (const b of badges) {
    const txt = (b.textContent || '').trim().toLowerCase();
    if (
      txt === 'презентація' ||
      txt === 'presentation' ||
      txt === 'презентация' ||
      txt.startsWith('презентація:') ||
      txt.startsWith('presentation:') ||
      txt.startsWith('презентация:') ||
      txt.endsWith('(презентація)') ||
      txt.endsWith('(presentation)') ||
      txt.endsWith('(презентация)') ||
      txt.includes('ваша презентація') ||
      txt.includes('your presentation') ||
      txt.includes('ви транслюєте екран') ||
      txt.includes('you are presenting')
    ) {
      return true;
    }
  }

  return false;
}

test('Reject webcam tiles even if they have pin button (keep_outline)', () => {
  const webcamTile = new MockElement('div', 'Андрій Коваль keep_outline mic_off');
  const pinBtn = new MockElement('button', 'keep_outline');
  pinBtn.setAttribute('aria-label', 'Закріпити користувача Андрій Коваль на головному екрані');
  webcamTile.appendChild(pinBtn);

  const muteBtn = new MockElement('button', 'mic_off');
  muteBtn.setAttribute('aria-label', 'Вимкнути мікрофон для користувача Андрій Коваль');
  webcamTile.appendChild(muteBtn);

  assert.equal(isPresentationTileCheck(webcamTile), false, 'Webcam tile must NOT be classified as presentation');
});

test('Correctly identify presentation tile by button aria-label', () => {
  const presTile = new MockElement('div', 'Андрій Коваль keep_outline');
  const pinBtn = new MockElement('button', 'keep_outline');
  pinBtn.setAttribute('aria-label', 'Закріпити презентацію користувача Андрій Коваль на головному екрані');
  presTile.appendChild(pinBtn);

  assert.equal(isPresentationTileCheck(presTile), true, 'Presentation tile must be identified');
});

test('Correctly identify presentation tile by present_to_all icon', () => {
  const presTile = new MockElement('div', 'Андрій Коваль present_to_all');
  assert.equal(isPresentationTileCheck(presTile), true, 'Presentation tile with present_to_all icon must be identified');
});

test('Correctly identify presentation tile by badge text', () => {
  const presTile = new MockElement('div', 'Андрій Коваль');
  const badge = new MockElement('span', 'Презентація: Андрій Коваль');
  presTile.appendChild(badge);
  assert.equal(isPresentationTileCheck(presTile), true, 'Presentation tile with badge must be identified');
});

test('Host menu option NEVER selects "Для всіх"', () => {
  const optionsUa = [
    { text: 'Для всіх' },
    { text: 'Лише для мене' }
  ];
  const selectedIndex = selectHostPinOption(optionsUa);
  assert.equal(selectedIndex, 1, 'Must select "Лише для мене" (index 1), NEVER "Для всіх"');
});

test('Host menu option in English selects "For myself only"', () => {
  const optionsEn = [
    { text: 'Pin for everyone' },
    { text: 'For myself only' }
  ];
  const selectedIndex = selectHostPinOption(optionsEn);
  assert.equal(selectedIndex, 1, 'Must select "For myself only" (index 1)');
});
