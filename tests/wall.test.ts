import test from 'node:test';
import assert from 'node:assert/strict';
import { ClassroomWall } from '../src/content/ui/wall.ts';
import type { ScreenShare } from '../src/types/index.ts';

class MockDomNode {
  public tagName: string;
  public className: string = '';
  public textContent: string = '';
  private _innerHTML: string = '';
  public title: string = '';
  public style: Record<string, string> = {};
  public children: MockDomNode[] = [];
  public parentElement: MockDomNode | null = null;
  public autoplay = false;
  public muted = false;
  public playsInline = false;
  public srcObject: any = null;
  public classList = {
    add: (c: string) => { this.className += ` ${c}`; },
    remove: (c: string) => { this.className = this.className.replace(c, '').trim(); },
    contains: (c: string) => this.className.includes(c),
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this._innerHTML;
  }

  set innerHTML(val: string) {
    this._innerHTML = val;
    if (val.includes('wall-grid')) {
      const grid = new MockDomNode('div');
      grid.className = 'wall-grid';
      const badge = new MockDomNode('div');
      badge.className = 'wall-badge';
      const closeBtn = new MockDomNode('button');
      closeBtn.className = 'wall-close-btn';
      const demoBtn = new MockDomNode('button');
      demoBtn.className = 'wall-demo-header-btn';
      this.appendChild(grid);
      this.appendChild(badge);
      this.appendChild(closeBtn);
      this.appendChild(demoBtn);
    } else if (val.includes('wall-card-placeholder')) {
      const vw = new MockDomNode('div');
      vw.className = 'wall-video-wrap';
      const ph = new MockDomNode('div');
      ph.className = 'wall-card-placeholder';
      const isPhHidden = val.includes('class="wall-card-placeholder" style="display: none;"');
      ph.style.display = isPhHidden ? 'none' : 'flex';
      const av = new MockDomNode('div');
      av.className = 'wall-card-avatar';
      const wait = new MockDomNode('div');
      wait.className = 'wall-card-waiting';
      ph.appendChild(av);
      ph.appendChild(wait);
      vw.appendChild(ph);
      this.appendChild(vw);

      const badge = new MockDomNode('div');
      badge.className = 'wall-card-badge';
      const num = new MockDomNode('span');
      num.className = 'wall-card-number';
      const name = new MockDomNode('span');
      name.className = 'wall-card-name';
      const ren = new MockDomNode('button');
      ren.className = 'wall-card-rename-btn';
      const st = new MockDomNode('span');
      st.className = 'wall-card-status';
      badge.appendChild(num);
      badge.appendChild(name);
      badge.appendChild(ren);
      badge.appendChild(st);
      this.appendChild(badge);
    }
  }

  appendChild(child: MockDomNode) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
    }
  }

  querySelector(sel: string): MockDomNode | null {
    const all = this.querySelectorAll(sel);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(sel: string): MockDomNode[] {
    const results: MockDomNode[] = [];
    const traverse = (n: MockDomNode) => {
      for (const child of n.children) {
        if (sel.startsWith('.') && child.className.includes(sel.slice(1))) {
          results.push(child);
        } else if (sel.toLowerCase() === child.tagName.toLowerCase()) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  addEventListener() {}
  play() { return Promise.resolve(); }
  pause() {}
}

test('ClassroomWall getInitials correctly formats participant initials', () => {
  const mockShadow = { appendChild: () => {} } as any;
  const prevDoc = (global as any).document;
  (global as any).document = {
    createElement: (tag: string) => new MockDomNode(tag),
  };

  try {
    const wall = new ClassroomWall(mockShadow, () => {});
    assert.equal(wall.getInitials('Богдан Рубаха'), 'БР');
    assert.equal(wall.getInitials('Aleksey Priymak'), 'AP');
    assert.equal(wall.getInitials('Леон'), 'ЛЕ');
    assert.equal(wall.getInitials('Roman Yevtushenko (Presentation)'), 'RY');
  } finally {
    (global as any).document = prevDoc;
  }
});

test('ClassroomWall renders placeholder when share has no video stream or not in DOM', () => {
  const mockShadow = { appendChild: () => {} } as any;
  const prevDoc = (global as any).document;
  (global as any).document = {
    createElement: (tag: string) => new MockDomNode(tag),
  };

  try {
    const wall = new ClassroomWall(mockShadow, () => {});
    const inactiveShare: ScreenShare = {
      id: 'student-1:pres',
      index: 1,
      participantName: 'Bohdan Rubakha',
      isPinned: false,
      isAvailableInDom: false,
      tileElement: null,
      videoElement: null,
    };

    wall.open([inactiveShare]);

    const cards = (wall as any).cardsMap;
    const cardItem = cards.get('student-1:pres');
    assert.ok(cardItem);
    // Video is hidden to prevent black box
    assert.equal(cardItem.videoEl.style.display, 'none');
    // Placeholder is displayed
    assert.equal(cardItem.placeholderEl.style.display, 'flex');
  } finally {
    (global as any).document = prevDoc;
  }
});

test('ClassroomWall displays video when stream is active in DOM', () => {
  const mockShadow = { appendChild: () => {} } as any;
  const prevDoc = (global as any).document;
  (global as any).document = {
    createElement: (tag: string) => new MockDomNode(tag),
  };

  try {
    const wall = new ClassroomWall(mockShadow, () => {});
    const mockStream = { id: 'stream-1' };
    const activeShare: ScreenShare = {
      id: 'student-2:pres',
      index: 2,
      participantName: 'Aleksey Priymak',
      isPinned: false,
      isAvailableInDom: true,
      tileElement: new MockDomNode('div') as any,
      videoElement: { srcObject: mockStream } as any,
    };

    wall.open([activeShare]);

    const cards = (wall as any).cardsMap;
    const cardItem = cards.get('student-2:pres');
    assert.ok(cardItem);
    // Live video is shown
    assert.equal(cardItem.videoEl.style.display, 'block');
    assert.equal(cardItem.videoEl.srcObject, mockStream);
    // Placeholder is hidden
    assert.equal(cardItem.placeholderEl.style.display, 'none');
  } finally {
    (global as any).document = prevDoc;
  }
});
