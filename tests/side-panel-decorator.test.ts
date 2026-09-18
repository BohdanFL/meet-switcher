import test from 'node:test';
import assert from 'node:assert/strict';
import { SidePanelDecorator } from '../src/content/ui/side-panel-decorator.ts';
import { AliasManager } from '../src/content/alias-manager.ts';

// Mock minimal DOM Element
class MockElement {
  public tagName: string;
  public textContent: string;
  private _innerHTML: string = '';
  public className: string;
  public title: string = '';
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
  public style: Record<string, string> = {};

  constructor(tagName: string, textContent = '') {
    this.tagName = tagName.toUpperCase();
    this.textContent = textContent;
    this.className = '';
    this.innerHTML = textContent;
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    if (val.includes('ms-alias-name')) {
      const aliasSpan = new MockElement('span');
      aliasSpan.className = 'ms-alias-name';
      this.children = [aliasSpan];
    }
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

  appendChild(child: MockElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  querySelector(selector: string): MockElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const parts = selector.split(',').map((s) => s.trim());
    const traverse = (el: MockElement) => {
      for (const child of el.children) {
        const matches = parts.some((p) => {
          if (p.startsWith('.') && child.className.includes(p.slice(1))) return true;
          if (p === 'button' && child.tagName === 'BUTTON') return true;
          if (p === 'aside' && child.tagName === 'ASIDE') return true;
          if (p.includes('role="button"') && (child.getAttribute('role') === 'button' || child.tagName === 'BUTTON')) return true;
          if (p.includes('role="listitem"') && child.getAttribute('role') === 'listitem') return true;
          if (p.includes('.notranslate') && child.className.includes('notranslate')) return true;
          if (p.includes('.ms-alias-name') && child.className.includes('ms-alias-name')) return true;
          if (p.includes('Side panel') && child.getAttribute('aria-label')?.toLowerCase().includes('side panel')) return true;
          if (p === 'span' && child.tagName === 'SPAN') return true;
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

test('SidePanelDecorator extractParticipantInfo resolves participant and presentation from buttons', () => {
  const decorator = new SidePanelDecorator(new AliasManager({ enableStorageSync: false }));

  // 1. Participant profile row
  const rowPerson = new MockElement('div');
  const muteBtn = new MockElement('button');
  muteBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's microphone");
  rowPerson.appendChild(muteBtn);

  const infoPerson = decorator.extractParticipantInfo(rowPerson as any);
  assert.ok(infoPerson);
  assert.equal(infoPerson.name, 'Bohdan Rubakha');
  assert.equal(infoPerson.isPresentation, false);

  // 2. Presentation row
  const rowPres = new MockElement('div');
  const presMuteBtn = new MockElement('button');
  presMuteBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's presentation");
  rowPres.appendChild(presMuteBtn);

  const infoPres = decorator.extractParticipantInfo(rowPres as any);
  assert.ok(infoPres);
  assert.equal(infoPres.name, 'Bohdan Rubakha');
  assert.equal(infoPres.isPresentation, true);

  // 3. Ukrainian button label
  const rowUa = new MockElement('div');
  const uaBtn = new MockElement('button');
  uaBtn.setAttribute('aria-label', 'Вимкнути мікрофон для користувача Богдан Рубаха');
  rowUa.appendChild(uaBtn);

  const infoUa = decorator.extractParticipantInfo(rowUa as any);
  assert.ok(infoUa);
  assert.equal(infoUa.name, 'Богдан Рубаха');
  assert.equal(infoUa.isPresentation, false);
});

test('SidePanelDecorator extractParticipantInfo resolves from notranslate element', () => {
  const decorator = new SidePanelDecorator(new AliasManager({ enableStorageSync: false }));

  const row = new MockElement('div');
  const nameSpan = new MockElement('span', 'Aleksey Priymak');
  nameSpan.className = 'notranslate';
  row.appendChild(nameSpan);

  const info = decorator.extractParticipantInfo(row as any);
  assert.ok(info);
  assert.equal(info.name, 'Aleksey Priymak');
  assert.equal(info.isPresentation, false);
});

test('SidePanelDecorator rewrites participant name into combined alias and original format', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'notranslate';
  row.appendChild(nameSpan);

  const muteBtn = new MockElement('button');
  muteBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's microphone");
  row.appendChild(muteBtn);

  decorator.decorateRow(row as any);

  assert.equal(nameSpan.getAttribute('data-ms-original'), 'Bohdan Rubakha');
  assert.equal(nameSpan.innerHTML.includes('Бодя'), true);
  assert.equal(nameSpan.innerHTML.includes('Bohdan Rubakha'), true);

  // When alias is removed, original name should be restored
  await aliasManager.removeAlias('Bohdan Rubakha');
  decorator.decorateRow(row as any);

  assert.equal(nameSpan.textContent, 'Bohdan Rubakha');
  assert.equal(nameSpan.hasAttribute('data-ms-original'), false);
});

test('SidePanelDecorator rewrites presentation row name into combined format with presentation label', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'notranslate';
  row.appendChild(nameSpan);

  const presBtn = new MockElement('button');
  presBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's presentation");
  row.appendChild(presBtn);

  decorator.decorateRow(row as any);

  assert.equal(nameSpan.getAttribute('data-ms-original'), 'Bohdan Rubakha');
  assert.equal(nameSpan.innerHTML.includes('Бодя'), true);
  assert.equal(nameSpan.innerHTML.includes('Bohdan Rubakha'), true);
});

test('SidePanelDecorator specifically targets span.zWGUib and ignores icon inside avatar (user DOM)', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Богдан');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', 'Bohdan Rubakha');

  const avatar = new MockElement('div');
  avatar.className = 'BEaVse';
  const extHU = new MockElement('div');
  extHU.className = 'extHU';
  const icon = new MockElement('i', 'devices');
  icon.className = 'google-symbols notranslate';
  extHU.appendChild(icon);
  avatar.appendChild(extHU);
  row.appendChild(avatar);

  const textContainer = new MockElement('div');
  textContainer.className = 'zSX24d';
  const jKwXVe = new MockElement('div');
  jKwXVe.className = 'jKwXVe';
  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'zWGUib';
  jKwXVe.appendChild(nameSpan);
  textContainer.appendChild(jKwXVe);
  row.appendChild(textContainer);

  decorator.decorateRow(row as any);

  // Icon must NOT be modified
  assert.equal(icon.hasAttribute('data-ms-original'), false, 'Icon must not have data-ms-original');
  assert.equal(icon.textContent, 'devices');

  // Name span MUST be modified
  assert.equal(nameSpan.getAttribute('data-ms-original'), 'Bohdan Rubakha');
  assert.equal(nameSpan.innerHTML.includes('Богдан'), true);
  assert.equal(nameSpan.innerHTML.includes('Bohdan Rubakha'), true);
});

test('SidePanelDecorator presentation row includes (презентація) tag', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'notranslate';
  row.appendChild(nameSpan);

  const presBtn = new MockElement('button');
  presBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's presentation");
  row.appendChild(presBtn);

  decorator.decorateRow(row as any);

  assert.equal(nameSpan.innerHTML.includes('презентація'), true);
});

test('SidePanelDecorator recovers from Wiz re-render (self-healing after plain text reset)', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Богдан');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  row.setAttribute('role', 'listitem');

  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'zWGUib';
  row.appendChild(nameSpan);

  // 1. Initial decoration
  decorator.decorateRow(row as any);
  assert.equal(nameSpan.innerHTML.includes('Богдан'), true);
  assert.equal(nameSpan.getAttribute('data-ms-formatted')?.includes('Богдан'), true);

  // 2. Simulate Google Meet Wiz framework wiping out innerHTML back to plain text
  // but leaving custom attributes untouched
  nameSpan.innerHTML = 'Bohdan Rubakha';
  nameSpan.children = []; // lost .ms-alias-name

  // 3. Decorator runs again on next scan / mutation / heartbeat
  decorator.decorateRow(row as any);

  // Self-healing should re-inject .ms-alias-name
  assert.equal(nameSpan.innerHTML.includes('Богдан'), true, 'Should re-inject alias span after Wiz reset');
  assert.ok(nameSpan.querySelector('.ms-alias-name'), 'ms-alias-name should be present');
});

test('SidePanelDecorator findPeoplePanel finds aside[aria-label="Side panel"]', () => {
  const decorator = new SidePanelDecorator(new AliasManager({ enableStorageSync: false }));

  const fakeDoc = new MockElement('body');
  const aside = new MockElement('aside');
  aside.setAttribute('aria-label', 'Side panel');
  fakeDoc.appendChild(aside);

  const found = decorator.findPeoplePanel(fakeDoc as any);
  assert.ok(found);
  assert.equal(found, aside);
});

test('SidePanelDecorator standard participant row with generic pin button extracts correct name from span.zWGUib', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Богдан');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  row.setAttribute('role', 'listitem');
  row.setAttribute('aria-label', 'Bohdan Rubakha');

  const textContainer = new MockElement('div');
  textContainer.className = 'zSX24d';
  const nameSpan = new MockElement('span', 'Bohdan Rubakha');
  nameSpan.className = 'zWGUib';
  textContainer.appendChild(nameSpan);
  row.appendChild(textContainer);

  // Generic pin button in Ukrainian Meet
  const pinBtn = new MockElement('button');
  pinBtn.setAttribute('aria-label', 'Закріпити на головному екрані');
  row.appendChild(pinBtn);

  const moreBtn = new MockElement('button');
  moreBtn.setAttribute('aria-label', 'Додаткові дії');
  row.appendChild(moreBtn);

  const info = decorator.extractParticipantInfo(row as any);
  assert.ok(info);
  assert.equal(info.name, 'Bohdan Rubakha');
  assert.equal(info.isPresentation, false);

  decorator.decorateRow(row as any);
  assert.equal(nameSpan.innerHTML.includes('Богдан'), true);
  assert.equal(nameSpan.innerHTML.includes('(Bohdan Rubakha)'), true);
  assert.equal(nameSpan.innerHTML.includes('презентація'), false, 'Standard participant row must not have presentation tag');
});

test('SidePanelDecorator cleans leading користувача from Ukrainian button label', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Богдан Рубаха', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  // Row where name element is missing or generic, but button has "Додаткові дії для користувача Богдан Рубаха"
  const row = new MockElement('div');
  row.setAttribute('role', 'listitem');

  const moreBtn = new MockElement('button');
  moreBtn.setAttribute('aria-label', 'Додаткові дії для користувача Богдан Рубаха');
  row.appendChild(moreBtn);

  const info = decorator.extractParticipantInfo(row as any);
  assert.ok(info);
  assert.equal(info.name, 'Богдан Рубаха');
  assert.equal(info.isPresentation, false);
});

