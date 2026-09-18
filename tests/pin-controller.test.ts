import test from 'node:test';
import assert from 'node:assert/strict';
import { PinController } from '../src/content/pin-controller.ts';
import { ScreenDetector } from '../src/content/detector.ts';

// Mock minimal DOM Element
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
        } else if (selector.includes('role="listitem"') && child.getAttribute('role') === 'listitem') {
          results.push(child);
        } else if (selector.includes('role="tabpanel"') && child.getAttribute('role') === 'tabpanel') {
          results.push(child);
        } else if (selector.includes('button') && child.tagName === 'BUTTON') {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  getBoundingClientRect() {
    return { width: 100, height: 100, top: 0, left: 0 };
  }

  dispatchEvent(event: any) {
    return true;
  }

  focus() {}
  scrollIntoView() {}
}

test('isPeoplePanelOpen detects open state by button aria-pressed and tabpanel', () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  const docClosed = {
    querySelector: (sel: string) => {
      if (sel.includes('People') || sel.includes('учасник')) {
        const btn = new MockElement('button');
        btn.setAttribute('aria-pressed', 'false');
        return btn;
      }
      return null;
    },
  } as any;

  assert.equal(controller.isPeoplePanelOpen(docClosed), false);

  const docOpen = {
    querySelector: (sel: string) => {
      if (sel.includes('People') || sel.includes('учасник')) {
        const btn = new MockElement('button');
        btn.setAttribute('aria-pressed', 'true');
        return btn;
      }
      return null;
    },
  } as any;

  assert.equal(controller.isPeoplePanelOpen(docOpen), true);
});

test('findPresentationItemInPeoplePanel locates participant presentation row', () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  const panel = new MockElement('div');
  panel.setAttribute('role', 'tabpanel');

  // Normal participant item
  const item1 = new MockElement('div', 'Roman Yevtushenko');
  item1.setAttribute('role', 'listitem');

  // Presentation item
  const item2 = new MockElement('div', 'Roman Yevtushenko (Presentation)');
  item2.setAttribute('role', 'listitem');
  const pinBtn = new MockElement('button');
  pinBtn.setAttribute('aria-label', "Pin Roman Yevtushenko's presentation to your main screen");
  item2.appendChild(pinBtn);

  panel.appendChild(item1);
  panel.appendChild(item2);

  const doc = {
    querySelector: () => panel,
    querySelectorAll: (sel: string) => panel.querySelectorAll(sel),
  } as any;

  const found = controller.findPresentationItemInPeoplePanel('Roman Yevtushenko', doc);
  assert.ok(found);
  assert.equal(found, item2);
});

test('openPeoplePanel clicks People button when closed and verifies open state', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  const peopleBtn = new MockElement('button');
  peopleBtn.setAttribute('aria-label', 'Show everyone');
  peopleBtn.setAttribute('aria-pressed', 'false');

  let clicked = false;
  peopleBtn.dispatchEvent = () => {
    clicked = true;
    peopleBtn.setAttribute('aria-pressed', 'true');
    return true;
  };

  const doc = {
    querySelector: (sel: string) => {
      if (sel.includes('People') || sel.includes('everyone') || sel.includes('учасник')) {
        return peopleBtn;
      }
      return null;
    },
  } as any;

  const opened = await controller.openPeoplePanel(doc);
  assert.equal(opened, true);
  assert.equal(clicked, true);
});

test('pinViaPeoplePanel clicks pin button on presentation item in people panel', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  let clickedPin = false;
  const panel = new MockElement('div');
  panel.setAttribute('role', 'tabpanel');

  const item = new MockElement('div', 'Aleksey Priymak (Presentation)');
  item.setAttribute('role', 'listitem');
  const pinBtn = new MockElement('button');
  pinBtn.setAttribute('aria-label', "Pin Aleksey Priymak's presentation");
  pinBtn.dispatchEvent = () => {
    clickedPin = true;
    return true;
  };
  item.appendChild(pinBtn);
  panel.appendChild(item);

  const peopleBtn = new MockElement('button');
  peopleBtn.setAttribute('aria-label', 'Show everyone');
  peopleBtn.setAttribute('aria-pressed', 'true');

  const doc = {
    querySelector: (sel: string) => {
      if (sel.includes('button')) {
        return peopleBtn;
      }
      if (sel.includes('tabpanel') || sel.includes('People') || sel.includes('учасник')) {
        return panel;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('role="listitem"')) return [item];
      return [];
    },
    body: panel,
  } as any;

  const result = await controller.pinViaPeoplePanel('Aleksey Priymak', doc);
  assert.equal(result, true);
  assert.equal(clickedPin, true);
});

test('switchToShare falls back to pinViaPeoplePanel when tile is not in DOM', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  let clickedPin = false;
  const panel = new MockElement('div');
  panel.setAttribute('role', 'tabpanel');

  const item = new MockElement('div', 'Bohdan Rubakha (Presentation)');
  item.setAttribute('role', 'listitem');
  const pinBtn = new MockElement('button');
  pinBtn.setAttribute('aria-label', "Pin Bohdan Rubakha's presentation");
  pinBtn.dispatchEvent = () => {
    clickedPin = true;
    return true;
  };
  item.appendChild(pinBtn);
  panel.appendChild(item);

  const peopleBtn = new MockElement('button');
  peopleBtn.setAttribute('aria-label', 'Show everyone');
  peopleBtn.setAttribute('aria-pressed', 'true');

  const prevDoc = (global as any).document;
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('button')) return peopleBtn;
      if (sel.includes('tabpanel') || sel.includes('People') || sel.includes('учасник')) return panel;
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('role="listitem"')) return [item];
      return [];
    },
    body: {
      contains: () => false,
      querySelectorAll: () => [],
    },
  };

  try {
    const targetShare = {
      id: 'device-test:pres',
      index: 1,
      participantName: 'Bohdan Rubakha',
      isPinned: false,
      isAvailableInDom: false,
      tileElement: null,
      videoElement: null,
    } as any;

    const switched = await controller.switchToShare(targetShare);
    assert.equal(switched, true);
    assert.equal(clickedPin, true);
    // Allow background scan to complete before restoring document mock
    await new Promise((r) => setTimeout(r, 120));
  } finally {
    (global as any).document = prevDoc;
  }
});
