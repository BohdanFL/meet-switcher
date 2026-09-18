import test from 'node:test';
import assert from 'node:assert/strict';
import { SidePanelDecorator } from '../src/content/ui/side-panel-decorator.ts';
import { AliasManager } from '../src/content/alias-manager.ts';

// Mock minimal DOM Element
class MockElement {
  public tagName: string;
  public textContent: string;
  public innerHTML: string;
  public className: string;
  public title: string = '';
  public attributes: Record<string, string> = {};
  public children: MockElement[] = [];
  public parentElement: MockElement | null = null;
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
          if (p.includes('role="button"') && (child.getAttribute('role') === 'button' || child.tagName === 'BUTTON')) return true;
          if (p.includes('role="listitem"') && child.getAttribute('role') === 'listitem') return true;
          if (p.includes('.notranslate') && child.className.includes('notranslate')) return true;
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

