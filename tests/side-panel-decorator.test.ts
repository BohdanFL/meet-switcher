import test from 'node:test';
import assert from 'node:assert/strict';
import { SidePanelDecorator, SIDE_PANEL_BADGE_CLASS, SIDE_PANEL_ADD_BTN_CLASS } from '../src/content/ui/side-panel-decorator.ts';
import { AliasManager } from '../src/content/alias-manager.ts';

// Mock minimal DOM Element
class MockElement {
  public tagName: string;
  public textContent: string;
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

test('SidePanelDecorator decorates row with alias badge when alias exists', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const muteBtn = new MockElement('button');
  muteBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's microphone");
  row.appendChild(muteBtn);

  const mockDoc = {
    createElement: (tag: string) => new MockElement(tag),
  };

  decorator.decorateRow(row as any, mockDoc as any);

  const badge = row.querySelector(`.${SIDE_PANEL_BADGE_CLASS}`);
  assert.ok(badge, 'Badge element must be created');
  assert.equal(badge.textContent, '🏷️ Бодя');
  assert.equal(badge.title.includes('Бодя'), true);
});

test('SidePanelDecorator decorates presentation row with presentation badge', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Bohdan Rubakha', 'Бодя');

  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const muteBtn = new MockElement('button');
  muteBtn.setAttribute('aria-label', "Mute Bohdan Rubakha's presentation");
  row.appendChild(muteBtn);

  const mockDoc = {
    createElement: (tag: string) => new MockElement(tag),
  };

  decorator.decorateRow(row as any, mockDoc as any);

  const badge = row.querySelector(`.${SIDE_PANEL_BADGE_CLASS}`);
  assert.ok(badge, 'Presentation badge element must be created');
  assert.equal(badge.textContent, '🏷️ Бодя (екран)');
  assert.equal(badge.className.includes('is-presentation'), true);
});

test('SidePanelDecorator adds add-button when no alias exists and removes when alias added', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  const decorator = new SidePanelDecorator(aliasManager);

  const row = new MockElement('div');
  const muteBtn = new MockElement('button');
  muteBtn.setAttribute('aria-label', "Mute Maria Ivanova's microphone");
  row.appendChild(muteBtn);

  const mockDoc = {
    createElement: (tag: string) => new MockElement(tag),
  };

  // Initially no alias: should show add button
  decorator.decorateRow(row as any, mockDoc as any);
  const addBtn = row.querySelector(`.${SIDE_PANEL_ADD_BTN_CLASS}`);
  assert.ok(addBtn, 'Add button must be present when student has no alias');

  // Now set alias: should replace add button with alias badge
  await aliasManager.setAlias('Maria Ivanova', 'Маша');
  decorator.decorateRow(row as any, mockDoc as any);

  assert.equal(row.querySelector(`.${SIDE_PANEL_ADD_BTN_CLASS}`), null, 'Add button must be removed');
  const badge = row.querySelector(`.${SIDE_PANEL_BADGE_CLASS}`);
  assert.ok(badge, 'Badge must be added');
  assert.equal(badge.textContent, '🏷️ Маша');
});
