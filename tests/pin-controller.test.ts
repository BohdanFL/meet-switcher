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
        } else if (selector.includes('role="menuitem"') && child.getAttribute('role') === 'menuitem') {
          results.push(child);
        } else if (selector.includes('role="option"') && child.getAttribute('role') === 'option') {
          results.push(child);
        } else if (selector.includes('li') && child.tagName === 'LI') {
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

  closest(selector: string): MockElement | null {
    let curr: MockElement | null = this;
    while (curr) {
      if (selector.includes('role="listitem"') && curr.getAttribute('role') === 'listitem') {
        return curr;
      }
      if (selector.includes('role="row"') && curr.getAttribute('role') === 'row') {
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

test('switchToShare unpins active stream and immediately notifies unpinned state when target is already pinned', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  let notifiedShares: any[] = [];
  detector.onUpdate((shares) => {
    notifiedShares = shares;
  });

  const pinnedShare = {
    id: 'device-pinned:pres',
    index: 1,
    participantName: 'Bohdan Rubakha',
    isPinned: true,
    isAvailableInDom: true,
    tileElement: null,
    videoElement: null,
  } as any;

  (detector as any).knownShares.set(pinnedShare.id, pinnedShare);
  (detector as any).currentShares = [pinnedShare];

  let unpinClicked = false;
  const unpinBtn = new MockElement('button', 'keep_off');
  unpinBtn.setAttribute('aria-label', 'Unpin Bohdan Rubakha');
  (unpinBtn as any).dispatchEvent = () => {
    unpinClicked = true;
    return true;
  };

  const prevDoc = (global as any).document;
  (global as any).document = {
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes('button')) return [unpinBtn];
      return [];
    },
    body: {
      contains: () => false,
      querySelectorAll: () => [unpinBtn],
    },
  };

  try {
    const res = await controller.switchToShare(pinnedShare);
    assert.equal(res, true, 'switchToShare must return true for toggle unpin');
    assert.equal(unpinClicked, true, 'Unpin button must be clicked');
    assert.equal(notifiedShares.length, 1);
    assert.equal(notifiedShares[0].isPinned, false, 'Notified share must have isPinned: false immediately');
    await new Promise((r) => setTimeout(r, 560));
  } finally {
    (global as any).document = prevDoc;
  }
});

test('handlePinMenuIfOpened strictly ignores generic dialogs (e.g. with Close button) and 3-dots menus', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  // Dialog with "Close" button (like what happened in the user log)
  const dialog = new MockElement('div');
  dialog.setAttribute('role', 'dialog');
  let closeClicked = false;
  const closeBtn = new MockElement('button', 'close');
  closeBtn.setAttribute('aria-label', 'Close');
  (closeBtn as any).dispatchEvent = () => {
    closeClicked = true;
    return true;
  };
  dialog.appendChild(closeBtn);

  // 3-dots actions menu (with "Pin to screen", "Don't watch", etc.)
  const moreMenu = new MockElement('div');
  moreMenu.setAttribute('role', 'menu');
  let morePinClicked = false;
  const morePinItem = new MockElement('div', 'Pin to the screen');
  morePinItem.setAttribute('role', 'menuitem');
  (morePinItem as any).dispatchEvent = () => {
    morePinClicked = true;
    return true;
  };
  moreMenu.appendChild(morePinItem);

  const doc = {
    querySelectorAll: (sel: string) => {
      if (sel.includes('dialog')) return [dialog];
      if (sel.includes('menu')) return [moreMenu];
      return [];
    },
  } as any;

  const handled = await (controller as any).handlePinMenuIfOpened(doc);
  assert.equal(handled, false, 'Must NOT handle or click generic dialogs or 3-dots menus');
  assert.equal(closeClicked, false, 'Must NEVER click Close button on dialog');
  assert.equal(morePinClicked, false, 'Must NEVER re-click 3-dots menu item');
});

test('handlePinMenuIfOpened detects genuine host pin menu and selects For myself only', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  const hostMenu = new MockElement('div');
  hostMenu.setAttribute('role', 'menu');

  let myselfClicked = false;
  const myselfItem = new MockElement('div', 'Лише для мене');
  myselfItem.setAttribute('role', 'menuitem');
  (myselfItem as any).dispatchEvent = () => {
    myselfClicked = true;
    return true;
  };

  const everyoneItem = new MockElement('div', 'Для всіх');
  everyoneItem.setAttribute('role', 'menuitem');

  hostMenu.appendChild(everyoneItem);
  hostMenu.appendChild(myselfItem);

  const doc = {
    querySelectorAll: (sel: string) => {
      if (sel.includes('menu')) return [hostMenu];
      return [];
    },
  } as any;

  const handled = await (controller as any).handlePinMenuIfOpened(doc);
  assert.equal(handled, true, 'Must handle genuine host pin menu');
  assert.equal(myselfClicked, true, 'Must select "Лише для мене"');
});

test('unpinActiveStreams clicks ALL unpin buttons on stage, not just the first one', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  let clickCount = 0;
  
  const btn1 = new MockElement('button', 'keep_off');
  btn1.setAttribute('aria-label', 'Unpin user 1');
  (btn1 as any).dispatchEvent = () => { clickCount++; return true; };
  
  const btn2 = new MockElement('button', 'keep_off');
  btn2.setAttribute('aria-label', 'Unpin user 2');
  (btn2 as any).dispatchEvent = () => { clickCount++; return true; };

  const prevDoc = (global as any).document;
  (global as any).document = {
    querySelectorAll: (sel: string) => {
      if (sel.includes('button')) return [btn1, btn2];
      return [];
    }
  };

  try {
    await controller.unpinActiveStreams();
    assert.equal(clickCount, 2, 'Should click both unpin buttons');
  } finally {
    (global as any).document = prevDoc;
  }
});

test('switchToShare unpins all existing pinned streams when pinning a new target', async () => {
  const detector = new ScreenDetector();
  const controller = new PinController(detector);

  const share1 = { id: 's1', index: 1, participantName: 'User 1', isPinned: true, isAvailableInDom: true, tileElement: new MockElement('div') } as any;
  const share2 = { id: 's2', index: 2, participantName: 'User 2', isPinned: true, isAvailableInDom: true, tileElement: new MockElement('div') } as any;
  const targetShare = { id: 's3', index: 3, participantName: 'User 3', isPinned: false, isAvailableInDom: true, tileElement: new MockElement('div') } as any;
  
  const targetPinBtn = new MockElement('button');
  targetPinBtn.setAttribute('aria-label', 'Pin');
  targetShare.tileElement.appendChild(targetPinBtn);

  (detector as any).knownShares.set(share1.id, share1);
  (detector as any).knownShares.set(share2.id, share2);
  (detector as any).knownShares.set(targetShare.id, targetShare);
  (detector as any).currentShares = [share1, share2, targetShare];

  // Mock global document
  const prevDoc = (global as any).document;
  
  let unpinClicks = 0;
  let targetPinClicked = false;
  
  (targetPinBtn as any).dispatchEvent = () => { targetPinClicked = true; return true; };
  
  const unpinBtn1 = new MockElement('button', 'keep_off');
  unpinBtn1.setAttribute('aria-label', 'Unpin');
  (unpinBtn1 as any).dispatchEvent = () => { unpinClicks++; return true; };
  share1.tileElement.appendChild(unpinBtn1);

  const unpinBtn2 = new MockElement('button', 'keep_off');
  unpinBtn2.setAttribute('aria-label', 'Unpin');
  (unpinBtn2 as any).dispatchEvent = () => { unpinClicks++; return true; };
  share2.tileElement.appendChild(unpinBtn2);
  
  (global as any).document = {
    body: {
      contains: () => true
    },
    querySelectorAll: () => []
  };

  detector.findPinButton = (el: any) => {
    if (el === targetShare.tileElement) return targetPinBtn as any;
    return null;
  };
  
  detector.findUnpinButton = (el: any) => {
    if (el === share1.tileElement) return unpinBtn1 as any;
    if (el === share2.tileElement) return unpinBtn2 as any;
    return null;
  };

  try {
    await controller.switchToShare(targetShare);
    assert.equal(targetPinClicked, true, 'Should click pin button on target');
    assert.equal(unpinClicks, 2, 'Should click unpin on both other shares');
  } finally {
    (global as any).document = prevDoc;
  }
});
