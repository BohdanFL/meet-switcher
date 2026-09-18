import test from 'node:test';
import assert from 'node:assert/strict';
import { ScreenDetector } from '../src/content/detector.ts';

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

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
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
        } else if (selector.includes('ink-canvas') && child.classList.contains('ink-canvas-parent')) {
          results.push(child);
        } else if (selector.includes('zoom') && (child.getAttribute('aria-label')?.toLowerCase().includes('zoom') || child.textContent.includes('zoom'))) {
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
      if (selector.includes('data-participant-id') && curr.getAttribute('data-participant-id')) {
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

test('Correctly identify presentation tile on center stage by Zoom controls', () => {
  const detector = new ScreenDetector();
  const stageTile = new MockElement('div', '');
  const zoomInBtn = new MockElement('button', 'zoom_in');
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  const zoomOutBtn = new MockElement('button', 'zoom_out');
  zoomOutBtn.setAttribute('aria-label', 'Zoom out');
  stageTile.appendChild(zoomInBtn);
  stageTile.appendChild(zoomOutBtn);

  assert.equal(detector.isPresentationTile(stageTile as any), true, 'Tile with zoom buttons must be identified as presentation');
});

test('Correctly identify presentation tile on center stage by ink canvas', () => {
  const detector = new ScreenDetector();
  const stageTile = new MockElement('div', '');
  const canvas = new MockElement('div', '');
  canvas.className = 'ink-canvas-parent';
  stageTile.appendChild(canvas);

  assert.equal(detector.isPresentationTile(stageTile as any), true, 'Tile with ink-canvas must be identified as presentation');
});

test('Validate participant name strictly rejects system phrases and UI strings', () => {
  const detector = new ScreenDetector();

  // Must reject:
  assert.equal(detector.isValidParticipantName('Try annotating (visible to everyone)'), false);
  assert.equal(detector.isValidParticipantName('Спробуйте анотувати (видимо для всіх)'), false);
  assert.equal(detector.isValidParticipantName('Zoom in'), false);
  assert.equal(detector.isValidParticipantName('Enter Full Screen'), false);
  assert.equal(detector.isValidParticipantName('More options for Alex'), false);
  assert.equal(detector.isValidParticipantName('You can\'t unmute someone else'), false);
  assert.equal(detector.isValidParticipantName('.ink-canvas-parent { height: 100%; }'), false);
  assert.equal(detector.isValidParticipantName('presentation'), false);
  assert.equal(detector.isValidParticipantName('презентація'), false);
  assert.equal(detector.isValidParticipantName('Учень / Presentation'), false);

  // Must accept:
  assert.equal(detector.isValidParticipantName('Татьяна'), true);
  assert.equal(detector.isValidParticipantName('Viktoria Hlushko'), true);
  assert.equal(detector.isValidParticipantName('Nelia Herasymiak'), true);
  assert.equal(detector.isValidParticipantName('Юля Примачук'), true);
  assert.equal(detector.isValidParticipantName('Мила Кочвар'), true);
  assert.equal(detector.isValidParticipantName('Michael Ryzhuk'), true);
  assert.equal(detector.isValidParticipantName('Богдан Рубаха'), true);
});

test('Normalize participant names correctly collapses whitespace, casing, and quotes', () => {
  const detector = new ScreenDetector();
  assert.equal(detector.normalizeParticipantName('  Viktoria   Hlushko  '), 'viktoria hlushko');
  assert.equal(detector.normalizeParticipantName('Татьяна'), 'татьяна');
  assert.equal(detector.normalizeParticipantName("Nelia O'Herasymiak"), 'nelia oherasymiak');
});

test('Center stage tile resolves expected participant name when controls are absent', () => {
  const detector = new ScreenDetector();
  detector.setExpectedPinnedParticipant('Татьяна');

  const stageTile = new MockElement('div', '');
  const zoomInBtn = new MockElement('button', 'zoom_in');
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  stageTile.appendChild(zoomInBtn);

  assert.equal(detector.isTilePinned(stageTile as any), true);
  assert.equal(detector.extractParticipantName(stageTile as any), 'Татьяна');
});

test('markAllUnpinned clears expected pinned participant', () => {
  const detector = new ScreenDetector();
  detector.setExpectedPinnedParticipant('Татьяна');
  detector.markAllUnpinned();

  const stageTile = new MockElement('div', '');
  const zoomInBtn = new MockElement('button', 'zoom_in');
  zoomInBtn.setAttribute('aria-label', 'Zoom in');
  stageTile.appendChild(zoomInBtn);

  assert.equal(detector.extractParticipantName(stageTile as any), 'Учень / Presentation');
});

test('Rejects annotation notice strings as participant names', () => {
  const detector = new ScreenDetector();
  assert.equal(detector.isValidParticipantName('Everyone can see your annotations'), false);
  assert.equal(detector.isValidParticipantName('Усі можуть бачити ваші анотації'), false);
  assert.equal(detector.isValidParticipantName('Все могут видеть ваши аннотации'), false);
  assert.equal(detector.isValidParticipantName('Try annotating'), false);
});

test('Identifies and filters out teacher own presentation from student shares', () => {
  const detector = new ScreenDetector();
  assert.equal(detector.isTeacherScreenName('Ваш екран (Ви)'), true);
  assert.equal(detector.isTeacherScreenName('Your presentation'), true);
  assert.equal(detector.isTeacherScreenName('Богдан Рубаха (Your Presentation)'), true);
  assert.equal(detector.isTeacherScreenName('Ваша презентація'), true);
  assert.equal(detector.isTeacherScreenName('Aleksey Priymak'), false);
  assert.equal(detector.isTeacherScreenName('Ольга Коваль'), false);
});

test('Replaces inactive participant slot when new stream arrives for same participant', () => {
  const detector = new ScreenDetector();

  // 1. First presentation from Aleksey Priymak
  const tile1 = new MockElement('div');
  tile1.setAttribute('data-participant-id', 'device-362');
  const video1 = new MockElement('video');
  const btn1 = new MockElement('button');
  btn1.setAttribute('aria-label', "Pin Aleksey Priymak's presentation to your main screen");
  tile1.appendChild(btn1);
  tile1.appendChild(video1);

  // Directly test internal registry update logic via scan
  (globalThis as any).document = {
    querySelectorAll: (sel: string) => (sel.includes('video') ? [video1] : []),
    querySelector: () => null,
  };

  detector.scan();
  const shares1 = detector.getScreenShares();
  assert.equal(shares1.length, 1);
  assert.equal(shares1[0].participantName, 'Aleksey Priymak');
  assert.equal(shares1[0].index, 1);

  // 2. Stream goes inactive (0 videos in DOM)
  (globalThis as any).document = {
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  detector.scan();
  const sharesInactive = detector.getScreenShares();
  assert.equal(sharesInactive.length, 1);
  assert.equal(sharesInactive[0].isAvailableInDom, false);

  // 3. Aleksey Priymak reconnects with new device ID (device-363)
  const tile2 = new MockElement('div');
  tile2.setAttribute('data-participant-id', 'device-363');
  const video2 = new MockElement('video');
  const btn2 = new MockElement('button');
  btn2.setAttribute('aria-label', "Pin Aleksey Priymak's presentation to your main screen");
  tile2.appendChild(btn2);
  tile2.appendChild(video2);

  (globalThis as any).document = {
    querySelectorAll: (sel: string) => (sel.includes('video') ? [video2] : []),
    querySelector: () => null,
  };
  detector.scan();

  const shares2 = detector.getScreenShares();
  // Must NOT create a second slot! Must reuse slot 1 for Aleksey Priymak
  assert.equal(shares2.length, 1);
  assert.equal(shares2[0].participantName, 'Aleksey Priymak');
  assert.equal(shares2[0].index, 1);
  assert.equal(shares2[0].isAvailableInDom, true);
  assert.equal(shares2[0].id, 'device-363:pres');

  delete (globalThis as any).document;
});

