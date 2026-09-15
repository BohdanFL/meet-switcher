# Student Nicknames & Account Aliases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teachers to assign persistent student nicknames to parents' Google accounts once, displaying combined labels `"${studentName} (${originalAccountName})"` across HUD, Classroom Wall, Google Meet video tiles, and extension popup.

**Architecture:** Standalone `AliasManager` service backed by `chrome.storage.sync` with local fallback and in-memory cache. Loose coupling with `SwitcherHud`, `ClassroomWall`, and a dedicated `TileBadgeDecorator` ensures zero interference with existing detection logic or parallel development streams.

**Tech Stack:** TypeScript 5.8, Chrome Extension Manifest V3 (`chrome.storage`), Vite 6.2, Node native test runner (`node --test`).

## Global Constraints
- Target Environment: Google Chrome (Manifest V3).
- Storage Key: `'meet_switcher_student_aliases'` in `chrome.storage.sync` (fallback to `chrome.storage.local`).
- Format: Always combined `"${studentName} (${originalAccountName})"` when an alias is set.
- Never directly mutate Google Meet's internal DOM text nodes (avoids React/Wiz reconciliation errors). Use floating overlay badges.
- All code must pass `npm run typecheck`, `npm test`, and `npm run build`.

---

### Task 1: Data Model & `AliasManager` Core Service

**Files:**
- Create: `src/types/alias.ts`
- Modify: `src/types/index.ts`
- Create: `src/content/alias-manager.ts`
- Test: `tests/alias-manager.test.ts`
- Modify: `package.json` (add test file to `test` script)

**Interfaces:**
- Produces:
  ```typescript
  export interface StudentAliasEntry {
    key: string;
    originalName: string;
    alias: string;
    updatedAt: number;
  }
  export type StudentAliasMap = Record<string, StudentAliasEntry>;

  export class AliasManager {
    static getInstance(): AliasManager;
    init(): Promise<void>;
    normalizeName(name: string): string;
    formatDisplayName(originalName: string): string;
    getAlias(originalName: string): string | null;
    setAlias(originalName: string, studentName: string): Promise<void>;
    removeAlias(originalName: string): Promise<void>;
    getAllAliases(): StudentAliasEntry[];
    importAliases(entries: StudentAliasEntry[]): Promise<number>;
    exportAliasesJson(): string;
    onUpdate(listener: () => void): () => void;
  }
  ```

- [ ] **Step 1: Create type definition file `src/types/alias.ts` and re-export in `src/types/index.ts`**

```typescript
// src/types/alias.ts
export interface StudentAliasEntry {
  /** Normalized lowercase lookup key (e.g. "оксана петренко") */
  key: string;

  /** Original Google Meet display name as detected (e.g. "Оксана Петренко") */
  originalName: string;

  /** Custom student nickname assigned by teacher (e.g. "Максим") */
  alias: string;

  /** Timestamp of when the alias was created or last updated */
  updatedAt: number;
}

export type StudentAliasMap = Record<string, StudentAliasEntry>;
```

In `src/types/index.ts`:
```typescript
export * from './alias';
```

- [ ] **Step 2: Write failing unit test `tests/alias-manager.test.ts`**

```typescript
// tests/alias-manager.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AliasManager } from '../src/content/alias-manager.ts';

test('AliasManager normalizes names correctly', () => {
  const manager = new AliasManager({ enableStorageSync: false });
  assert.equal(manager.normalizeName('  Оксана Петренко  '), 'оксана петренко');
  assert.equal(manager.normalizeName('Оксана Петренко (презентація)'), 'оксана петренко');
  assert.equal(manager.normalizeName("John Doe's presentation"), 'john doe');
});

test('AliasManager formats display name with combined format', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Оксана Петренко');

  await manager.setAlias('Оксана Петренко', 'Максим');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Максим (Оксана Петренко)');
  assert.equal(manager.getAlias('Оксана Петренко'), 'Максим');
});

test('AliasManager removes alias when empty string is set', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Максим (Оксана Петренко)');

  await manager.removeAlias('Оксана Петренко');
  assert.equal(manager.formatDisplayName('Оксана Петренко'), 'Оксана Петренко');
  assert.equal(manager.getAlias('Оксана Петренко'), null);
});

test('AliasManager exports and imports aliases JSON', async () => {
  const manager = new AliasManager({ enableStorageSync: false });
  await manager.setAlias('Оксана Петренко', 'Максим');
  await manager.setAlias('Ігор Коваль', 'Данило');

  const json = manager.exportAliasesJson();
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 2);

  const manager2 = new AliasManager({ enableStorageSync: false });
  const importedCount = await manager2.importAliases(parsed);
  assert.equal(importedCount, 2);
  assert.equal(manager2.formatDisplayName('Ігор Коваль'), 'Данило (Ігор Коваль)');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/alias-manager.test.ts`
Expected: FAIL (Cannot find module `../src/content/alias-manager.ts`)

- [ ] **Step 4: Implement `AliasManager` in `src/content/alias-manager.ts`**

```typescript
// src/content/alias-manager.ts
import { StudentAliasEntry, StudentAliasMap } from '../types';

export interface AliasManagerOptions {
  enableStorageSync?: boolean;
}

export class AliasManager {
  private static instance: AliasManager | null = null;
  private cache: Map<string, StudentAliasEntry> = new Map();
  private listeners: Set<() => void> = new Set();
  private isInitialized = false;
  private storageKey = 'meet_switcher_student_aliases';
  private enableStorageSync = true;

  constructor(options?: AliasManagerOptions) {
    if (options?.enableStorageSync !== undefined) {
      this.enableStorageSync = options.enableStorageSync;
    }
    if (this.enableStorageSync) {
      this.listenToStorageChanges();
    }
  }

  public static getInstance(): AliasManager {
    if (!AliasManager.instance) {
      AliasManager.instance = new AliasManager();
    }
    return AliasManager.instance;
  }

  public normalizeName(name: string): string {
    if (!name) return '';
    return name
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*)/i, '')
      .replace(/\s*\(презентація\)$/i, '')
      .replace(/\s*\(presentation\)$/i, '')
      .replace(/\s*\(презентация\)$/i, '')
      .replace(/'s presentation$/i, '')
      .trim()
      .toLowerCase();
  }

  public async init(): Promise<void> {
    if (this.isInitialized || !this.enableStorageSync) {
      this.isInitialized = true;
      return;
    }

    try {
      const data = await this.readStorage();
      this.cache.clear();
      for (const [key, entry] of Object.entries(data)) {
        this.cache.set(key, entry);
      }
    } catch (err) {
      console.warn('[MeetSwitcher:AliasManager] Failed to load aliases from storage:', err);
    } finally {
      this.isInitialized = true;
      this.notifyListeners();
    }
  }

  public getAlias(originalName: string): string | null {
    const key = this.normalizeName(originalName);
    const entry = this.cache.get(key);
    return entry && entry.alias.trim() ? entry.alias.trim() : null;
  }

  public formatDisplayName(originalName: string): string {
    const alias = this.getAlias(originalName);
    if (alias) {
      return `${alias} (${originalName})`;
    }
    return originalName;
  }

  public async setAlias(originalName: string, studentName: string): Promise<void> {
    const trimmedAlias = studentName.trim();
    if (!trimmedAlias) {
      await this.removeAlias(originalName);
      return;
    }

    const key = this.normalizeName(originalName);
    const entry: StudentAliasEntry = {
      key,
      originalName: originalName.trim(),
      alias: trimmedAlias,
      updatedAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.notifyListeners();

    if (this.enableStorageSync) {
      await this.saveStorage();
    }
  }

  public async removeAlias(originalName: string): Promise<void> {
    const key = this.normalizeName(originalName);
    if (this.cache.delete(key)) {
      this.notifyListeners();
      if (this.enableStorageSync) {
        await this.saveStorage();
      }
    }
  }

  public getAllAliases(): StudentAliasEntry[] {
    return Array.from(this.cache.values()).sort((a, b) =>
      a.alias.localeCompare(b.alias, 'uk')
    );
  }

  public exportAliasesJson(): string {
    return JSON.stringify(this.getAllAliases(), null, 2);
  }

  public async importAliases(entries: StudentAliasEntry[]): Promise<number> {
    let count = 0;
    for (const item of entries) {
      if (item && item.originalName && item.alias) {
        const key = this.normalizeName(item.originalName);
        this.cache.set(key, {
          key,
          originalName: item.originalName.trim(),
          alias: item.alias.trim(),
          updatedAt: item.updatedAt || Date.now(),
        });
        count++;
      }
    }

    this.notifyListeners();
    if (this.enableStorageSync) {
      await this.saveStorage();
    }
    return count;
  }

  public onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[MeetSwitcher:AliasManager] Listener error:', err);
      }
    }
  }

  private async readStorage(): Promise<StudentAliasMap> {
    return new Promise((resolve) => {
      const storage = chrome?.storage?.sync || chrome?.storage?.local;
      if (!storage) {
        resolve({});
        return;
      }

      storage.get(this.storageKey, (res) => {
        if (chrome.runtime?.lastError) {
          // Fallback to local
          chrome.storage?.local?.get(this.storageKey, (localRes) => {
            resolve((localRes?.[this.storageKey] as StudentAliasMap) || {});
          });
          return;
        }
        resolve((res?.[this.storageKey] as StudentAliasMap) || {});
      });
    });
  }

  private async saveStorage(): Promise<void> {
    const data: StudentAliasMap = {};
    for (const [key, entry] of this.cache.entries()) {
      data[key] = entry;
    }

    return new Promise((resolve) => {
      const storage = chrome?.storage?.sync || chrome?.storage?.local;
      if (!storage) {
        resolve();
        return;
      }

      storage.set({ [this.storageKey]: data }, () => {
        if (chrome.runtime?.lastError) {
          // Fallback to local storage if sync quota exceeded
          chrome.storage?.local?.set({ [this.storageKey]: data }, () => resolve());
        } else {
          resolve();
        }
      });
    });
  }

  private listenToStorageChanges(): void {
    try {
      chrome?.storage?.onChanged?.addListener((changes, areaName) => {
        if (changes[this.storageKey]) {
          const newData = (changes[this.storageKey].newValue as StudentAliasMap) || {};
          this.cache.clear();
          for (const [key, entry] of Object.entries(newData)) {
            this.cache.set(key, entry);
          }
          this.notifyListeners();
        }
      });
    } catch {
      // Ignore in non-extension environments
    }
  }
}
```

- [ ] **Step 5: Run tests and verify they pass**

Update `package.json` test script:
```json
"test": "node --test --experimental-strip-types tests/detector.test.ts tests/logger.test.ts tests/call-monitor.test.ts tests/alias-manager.test.ts"
```
Run: `npm test`
Expected: All 15+ tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/types/alias.ts src/types/index.ts src/content/alias-manager.ts tests/alias-manager.test.ts package.json
git commit -m "feat(aliases): add StudentAlias types and AliasManager core service with unit tests"
```

---

### Task 2: Inline Editing & Alias Display in Switcher HUD

**Files:**
- Modify: `src/content/ui/hud.ts`
- Modify: `src/content/ui/styles.css`

**Interfaces:**
- Consumes: `AliasManager.getInstance()`
- Produces: Inline edit controls (✏️ icon, `<input>` on click, Enter to save, Esc to cancel) in HUD rows, formatted name display with `🏷️` indicator.

- [ ] **Step 1: Update `src/content/ui/styles.css` for HUD alias styling**

Add styles for:
- `.screen-name-wrap`: flex container holding name and action button.
- `.alias-tag`: small tag icon `🏷️` with tooltip.
- `.btn-rename`: subtle edit button (pencil ✏️) with opacity 0 on normal state, opacity 1 on hover.
- `.inline-edit-wrap`: inline `<input class="rename-input">` and `<button class="rename-save-btn">✓</button>` `<button class="rename-cancel-btn">✕</button>`.

- [ ] **Step 2: Update `src/content/ui/hud.ts`**

1. Import `AliasManager`.
2. In constructor, subscribe:
   ```typescript
   this.aliasManager = AliasManager.getInstance();
   this.aliasManager.onUpdate(() => this.renderList());
   ```
3. In `renderList()`, for each share:
   - Format name: `const displayName = this.aliasManager.formatDisplayName(share.participantName);`
   - Check if has alias: `const hasAlias = Boolean(this.aliasManager.getAlias(share.participantName));`
   - Render name with `hasAlias ? '<span class="alias-tag" title="Встановлено псевдонім">🏷️</span>' : ''`.
   - Add edit button `<button class="btn-rename" title="Перейменувати учня (встановити псевдонім)">✏️</button>`.
   - Wire click handler for `btn-rename` with `e.stopPropagation()`:
     - Replaces item content with inline `<input>` containing current alias (or empty).
     - `input.focus()` and `input.select()`.
     - Keydown listener on input:
       - `Enter`: `await this.aliasManager.setAlias(share.participantName, input.value);`
       - `Escape`: cancel editing and re-render.
     - Prevent row click event when clicking input or buttons.

- [ ] **Step 3: Run typecheck to verify no compiler errors**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/content/ui/hud.ts src/content/ui/styles.css
git commit -m "feat(hud): add student alias display and 1-click inline editing in HUD"
```

---

### Task 3: Inline Editing & Alias Display in Classroom Wall

**Files:**
- Modify: `src/content/ui/wall.ts`
- Modify: `src/content/ui/styles.css`

**Interfaces:**
- Consumes: `AliasManager.getInstance()`
- Produces: Card header alias display and inline editing in Classroom Wall.

- [ ] **Step 1: Update `src/content/ui/wall.ts`**

1. Import `AliasManager`.
2. In constructor, subscribe to `aliasManager.onUpdate(() => this.render())`.
3. In `render()`, when updating existing card or creating new card:
   - Formatted name: `aliasManager.formatDisplayName(share.participantName)`.
   - Update `existing.nameEl.textContent = displayName;`
   - In card badge HTML:
     ```html
     <div class="wall-card-badge">
       <span class="wall-card-number">${share.index}</span>
       <span class="wall-card-name">${this.escapeHtml(displayName)}</span>
       <button class="wall-card-rename-btn" title="Перейменувати учня (Alt+клік або олівець)">✏️</button>
       <span class="wall-card-status" style="${share.isPinned ? '' : 'display: none;'}">📌 В центрі</span>
     </div>
     ```
   - Wire `wall-card-rename-btn` click with `e.stopPropagation()`:
     - Turns card name into an inline input for quick renaming right inside the wall.
     - Saves on Enter, cancels on Escape.

- [ ] **Step 2: Run typecheck to verify no compiler errors**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

- [ ] **Step 3: Commit Task 3**

```bash
git add src/content/ui/wall.ts src/content/ui/styles.css
git commit -m "feat(wall): add student alias display and inline editing in Classroom Wall"
```

---

### Task 4: Google Meet Video Tile Badge Decorator

**Files:**
- Create: `src/content/ui/tile-badge.ts`
- Modify: `src/content/index.ts`
- Test: `tests/tile-badge.test.ts`

**Interfaces:**
- Consumes: `AliasManager.getInstance()`, `ScreenShare`
- Produces:
  ```typescript
  export class TileBadgeDecorator {
    constructor(aliasManager: AliasManager);
    updateBadges(shares: ScreenShare[]): void;
    destroy(): void;
  }
  ```

- [ ] **Step 1: Write unit test `tests/tile-badge.test.ts`**

```typescript
// tests/tile-badge.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { TileBadgeDecorator } from '../src/content/ui/tile-badge.ts';
import { AliasManager } from '../src/content/alias-manager.ts';
import { ScreenShare } from '../src/types';

test('TileBadgeDecorator mounts badge on tile when alias exists', async () => {
  const aliasManager = new AliasManager({ enableStorageSync: false });
  await aliasManager.setAlias('Оксана Петренко', 'Максим');

  const decorator = new TileBadgeDecorator(aliasManager);

  // Mock DOM elements
  const tile = {
    querySelector: (sel: string) => null,
    appendChild: (el: any) => { tile._child = el; },
    _child: null as any,
  } as any;

  const shares: ScreenShare[] = [
    {
      id: 'tile-1',
      index: 1,
      participantName: 'Оксана Петренко',
      isPinned: false,
      tileElement: tile,
    },
  ];

  decorator.updateTile(shares[0]);
  assert.ok(tile._child);
  assert.equal(tile._child.textContent, '🏷️ Максим (Оксана Петренко)');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/tile-badge.test.ts`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Implement `TileBadgeDecorator` in `src/content/ui/tile-badge.ts`**

```typescript
// src/content/ui/tile-badge.ts
import { ScreenShare } from '../../types';
import { AliasManager } from '../alias-manager';

const BADGE_CLASS = 'meet-switcher-student-badge';

export class TileBadgeDecorator {
  private aliasManager: AliasManager;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  public updateTile(share: ScreenShare): void {
    if (!share.tileElement || typeof share.tileElement.querySelector !== 'function') {
      return;
    }

    const alias = this.aliasManager.getAlias(share.participantName);
    const existingBadge = share.tileElement.querySelector<HTMLElement>(`.${BADGE_CLASS}`);

    if (alias) {
      const displayName = this.aliasManager.formatDisplayName(share.participantName);
      const badgeText = `🏷️ ${displayName}`;

      if (existingBadge) {
        if (existingBadge.textContent !== badgeText) {
          existingBadge.textContent = badgeText;
        }
      } else {
        const badge = document.createElement('div');
        badge.className = BADGE_CLASS;
        badge.textContent = badgeText;
        badge.title = `Псевдонім учня: ${alias} (Акаунт: ${share.participantName})`;

        // Inline CSS styles to guarantee appearance regardless of Google Meet CSS
        Object.assign(badge.style, {
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: '15',
          background: 'rgba(15, 17, 23, 0.88)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: '#ffffff',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '500',
          fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
          letterSpacing: '0.2px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          pointerEvents: 'none',
          transition: 'opacity 0.2s ease',
        });

        // Ensure container is positioned for absolute child
        try {
          const currentPos = window.getComputedStyle(share.tileElement).position;
          if (!currentPos || currentPos === 'static') {
            share.tileElement.style.position = 'relative';
          }
        } catch {}

        share.tileElement.appendChild(badge);
      }
    } else if (existingBadge) {
      existingBadge.remove();
    }
  }

  public updateBadges(shares: ScreenShare[]): void {
    for (const share of shares) {
      this.updateTile(share);
    }
  }

  public destroy(): void {
    const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
    badges.forEach((b) => b.remove());
  }
}
```

- [ ] **Step 4: Connect `TileBadgeDecorator` and `AliasManager` in `src/content/index.ts`**

1. Initialize `AliasManager`:
   ```typescript
   const aliasManager = AliasManager.getInstance();
   aliasManager.init();
   ```
2. Initialize `TileBadgeDecorator`:
   ```typescript
   const tileDecorator = new TileBadgeDecorator(aliasManager);
   ```
3. In `detector.onUpdate(shares => { ... })`:
   ```typescript
   tileDecorator.updateBadges(shares);
   ```
4. Listen to `aliasManager.onUpdate(() => { ... })` and re-run `tileDecorator.updateBadges(detector.getScreenShares())`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run typecheck`
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/content/ui/tile-badge.ts src/content/index.ts tests/tile-badge.test.ts package.json
git commit -m "feat(tiles): add TileBadgeDecorator for floating student badges on Google Meet video tiles"
```

---

### Task 5: Extension Popup Roster Tab (View, Search, Edit, Delete, Export/Import)

**Files:**
- Modify: `src/popup/popup.html`
- Modify: `src/popup/popup.ts`
- Modify: `src/popup/popup.css`

**Interfaces:**
- Consumes: `chrome.storage.sync` / `chrome.storage.local` with key `'meet_switcher_student_aliases'`
- Produces:
  - Tab navigation: `[📋 Діагностика] [👥 Учні та псевдоніми]`
  - Search bar to filter saved students
  - Add form: Original Name + Student Name + Add button
  - Table/list of aliases with quick Delete and Edit
  - JSON Export button (`meet-students-backup-YYYY-MM-DD.json`)
  - JSON Import button (file input)

- [ ] **Step 1: Add tab navigation and Roster section to `src/popup/popup.html`**

Add:
```html
<nav class="popup-tabs">
  <button class="tab-btn active" data-tab="tab-diagnostics">📋 Журнал уроку</button>
  <button class="tab-btn" data-tab="tab-roster">👥 Учні та псевдоніми</button>
</nav>
```
And `<div id="tab-roster" class="tab-pane">` containing:
- Quick Add form (inputs for `originalName` and `alias`, plus button).
- Search input (`filter-roster-input`).
- Empty state: *"Немає збережених учнів. Введіть ім'я під час уроку в HUD (✏️) або додайте вище."*
- Roster list container (`#roster-list`).
- Actions toolbar:
  - `btn-export-roster`: "⬇ Експорт (JSON)"
  - `btn-import-roster`: "⬆ Імпорт (JSON)"
  - Hidden file input `<input type="file" id="import-file-input" accept=".json" style="display: none;">`

- [ ] **Step 2: Add styles in `src/popup/popup.css`**

Add styles for:
- `.popup-tabs`, `.tab-btn`, `.tab-btn.active`.
- `.tab-pane` visibility toggles.
- `.roster-form`, `.roster-input`, `.btn-add-student`.
- `.roster-item`, `.roster-names`, `.roster-orig`, `.roster-alias`.
- `.roster-actions-bar`.

- [ ] **Step 3: Implement Roster logic in `src/popup/popup.ts`**

1. Tab switching handler.
2. Load aliases from `chrome.storage.sync` (fallback to `local`).
3. Render filtered list of items with delete `🗑️` button and edit button.
4. Wire quick-add form to store new entry and refresh.
5. Wire JSON export: creates a Blob with formatted JSON and downloads via `URL.createObjectURL(blob)`.
6. Wire JSON import: reads file via `FileReader`, validates array of entries, saves to storage, and refreshes list.

- [ ] **Step 4: Run typecheck and build**

Run: `npm run typecheck`
Run: `npm run build`
Expected: PASS with clean build.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/popup/popup.html src/popup/popup.ts src/popup/popup.css
git commit -m "feat(popup): add student roster tab with search, management, and JSON import/export"
```

---

### Task 6: End-to-End Verification & Demo Simulation Check

**Files:**
- Modify: `src/content/mock-generator.ts` (if needed to verify mock aliases)

- [ ] **Step 1: Run complete automated test suite**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 2: Run type check**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: All bundles (`content.js`, `background.js`, `popup.js`) successfully generated in `dist/`.

- [ ] **Step 4: Commit all final adjustments**

```bash
git add -A
git commit -m "chore: complete student alias implementation verification"
```
