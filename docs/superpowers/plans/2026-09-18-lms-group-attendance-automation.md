# LMS Group Import & Real-Time Attendance Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated real-time attendance tracking and 1-click report generation system for managers, including 1-click group import from Algoritmika LMS (`lms.alg.academy`), automatic call title recognition in Google Meet, student account pairing, icon-only HUD attendance button (`📋`), and formatted clipboard export.

**Architecture:** An LMS content script injects an import button on `https://lms.alg.academy/group/view/*#group-student-grid` to extract student rosters and save them to `chrome.storage.sync`. In `meet.google.com`, a call title detector identifies the group name, an attendance tracker matches active participants against enrolled students, and an icon-only `📋` button in the HUD opens an attendance modal with live `+`/`-` badges and a 1-click "📋 Скопіювати для менеджера" export button.

**Tech Stack:** TypeScript, Vite, WebExtensions API (`chrome.storage.sync`), Web Components / Shadow DOM, Node.js test runner (`node:test`).

## Global Constraints
- Google Meet call title selector: `div[role="heading"] .u6vdEc, [jsname="NeC6gb"].u6vdEc, .ND08le .u6vdEc, .EY8ABd-OWXEXe-TAWMXe[role="tooltip"]`
- LMS group name selector: `.GroupCard__header__title .EditableArea__input, #group-view .GroupCard__header__title`
- LMS student link selector: `#group-student-grid a[href*="/student/update/"]`
- LMS button insertion container: `#group-student-grid .panel-heading .group-students .col-sm-12` or `.GroupStudent__list`
- Attendance export line format: `{fullName} ({lmsUrl}) ({meetOriginalName || "не прив'язано"}) {status ? '+' : '-'}`
- HUD trigger button: icon-only `📋` (no text label), tooltip/title `"Відвідуваність уроку"`
- Keep existing 66 tests passing and preserve backwards compatibility with `AliasManager`

---

### Task 1: Data Structures & Group Storage Manager (`GroupStore`)

**Files:**
- Create: `src/types/attendance.ts`
- Modify: `src/types/index.ts:47-49`
- Create: `src/content/attendance/group-store.ts`
- Test: `tests/group-store.test.ts`

**Interfaces:**
- Produces:
  - `GroupStudent`: `{ id: string; fullName: string; lmsUrl: string; meetOriginalName?: string; shortAlias?: string; }`
  - `StudentGroup`: `{ id: string; name: string; lmsUrl: string; students: GroupStudent[]; updatedAt: number; }`
  - `StudentGroupMap`: `Record<string, StudentGroup>`
  - `STORAGE_KEY_LMS_GROUPS = 'meet_switcher_lms_groups'`
  - `GroupStore`:
    - `getAllGroups(): Promise<StudentGroupMap>`
    - `getGroup(id: string): Promise<StudentGroup | null>`
    - `saveGroup(group: StudentGroup): Promise<void>`
    - `deleteGroup(id: string): Promise<void>`
    - `findGroupByTitle(callTitle: string): Promise<StudentGroup | null>`
    - `pairStudent(groupId: string, studentId: string, meetOriginalName: string, shortAlias?: string): Promise<void>`
    - `unpairStudent(groupId: string, studentId: string): Promise<void>`

- [ ] **Step 1: Write the failing test for `GroupStore`**

```ts
// tests/group-store.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { GroupStore } from '../src/content/attendance/group-store.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

test('GroupStore saves and retrieves student groups from in-memory / storage fallback', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  
  const sampleGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601#group-student-grid',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };

  await store.saveGroup(sampleGroup);
  const fetched = await store.getGroup('2595601');
  assert.ok(fetched);
  assert.equal(fetched.name, 'УКР_Гейм_ЧТ_19:00');
  assert.equal(fetched.students.length, 2);
});

test('GroupStore finds group by Google Meet call title (fuzzy & exact)', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [],
  });

  // Exact match
  const exact = await store.findGroupByTitle('УКР_Гейм_ЧТ_19:00');
  assert.ok(exact);
  assert.equal(exact.id, '2595601');

  // Whitespace and case tolerance
  const normalized = await store.findGroupByTitle('  укр_гейм_чт_19:00 ');
  assert.ok(normalized);
  assert.equal(normalized.id, '2595601');

  // Match by group ID in title if title contains it
  const byId = await store.findGroupByTitle('Meeting 2595601 Call');
  assert.ok(byId);
  assert.equal(byId.id, '2595601');

  // Non-matching title returns null
  const none = await store.findGroupByTitle('Some Other Call');
  assert.equal(none, null);
});

test('GroupStore pairs and unpairs Google Meet participant name to LMS student', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
    ],
  });

  await store.pairStudent('2595601', '6753930', 'Iryna Alfeldi', 'Камалія');
  const group = await store.getGroup('2595601');
  assert.ok(group);
  assert.equal(group.students[0].meetOriginalName, 'Iryna Alfeldi');
  assert.equal(group.students[0].shortAlias, 'Камалія');

  await store.unpairStudent('2595601', '6753930');
  const unpairedGroup = await store.getGroup('2595601');
  assert.ok(unpairedGroup);
  assert.equal(unpairedGroup.students[0].meetOriginalName, undefined);
  assert.equal(unpairedGroup.students[0].shortAlias, undefined);
});

test('GroupStore merges new import preserving existing pairings', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  await store.saveGroup({
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: 1000,
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
        meetOriginalName: 'Iryna Alfeldi',
        shortAlias: 'Камалія',
      },
    ],
  });

  // Re-importing with an additional student
  const updatedGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00 (Оновлена)',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: 2000,
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };

  await store.saveGroup(updatedGroup);
  const result = await store.getGroup('2595601');
  assert.ok(result);
  assert.equal(result.students.length, 2);
  // Pairing preserved!
  assert.equal(result.students[0].meetOriginalName, 'Iryna Alfeldi');
  assert.equal(result.students[0].shortAlias, 'Камалія');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/group-store.test.ts`
Expected: FAIL with module not found (`attendance.ts` / `group-store.ts`)

- [ ] **Step 3: Implement `src/types/attendance.ts`, `src/types/index.ts`, and `src/content/attendance/group-store.ts`**

```ts
// src/types/attendance.ts
export interface GroupStudent {
  id: string;
  fullName: string;
  lmsUrl: string;
  meetOriginalName?: string;
  shortAlias?: string;
}

export interface StudentGroup {
  id: string;
  name: string;
  lmsUrl: string;
  students: GroupStudent[];
  updatedAt: number;
}

export type StudentGroupMap = Record<string, StudentGroup>;

export const STORAGE_KEY_LMS_GROUPS = 'meet_switcher_lms_groups';
```

Export from `src/types/index.ts`:
```ts
export * from './attendance.ts';
```

And `src/content/attendance/group-store.ts`:
```ts
// src/content/attendance/group-store.ts
import {
  StudentGroup,
  StudentGroupMap,
  STORAGE_KEY_LMS_GROUPS,
} from '../../types/attendance.ts';

export interface GroupStoreOptions {
  enableStorageSync?: boolean;
}

export class GroupStore {
  private static instance: GroupStore | null = null;
  private groups: StudentGroupMap = {};
  private enableStorageSync: boolean;
  private isLoaded = false;
  private listeners: Array<(groups: StudentGroupMap) => void> = [];

  constructor(options: GroupStoreOptions = {}) {
    this.enableStorageSync = options.enableStorageSync ?? true;
  }

  public static getInstance(): GroupStore {
    if (!GroupStore.instance) {
      GroupStore.instance = new GroupStore();
    }
    return GroupStore.instance;
  }

  public async init(): Promise<void> {
    if (!this.enableStorageSync || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      this.isLoaded = true;
      return;
    }

    try {
      const res = await chrome.storage.sync.get(STORAGE_KEY_LMS_GROUPS);
      if (res && res[STORAGE_KEY_LMS_GROUPS]) {
        this.groups = res[STORAGE_KEY_LMS_GROUPS];
      }
    } catch (err) {
      console.warn('[MeetSwitcher:GroupStore] Error loading groups from sync, trying local:', err);
      try {
        const localRes = await chrome.storage?.local?.get(STORAGE_KEY_LMS_GROUPS);
        if (localRes && localRes[STORAGE_KEY_LMS_GROUPS]) {
          this.groups = localRes[STORAGE_KEY_LMS_GROUPS];
        }
      } catch (localErr) {
        console.warn('[MeetSwitcher:GroupStore] Local storage fallback failed:', localErr);
      }
    }
    this.isLoaded = true;
  }

  public async getAllGroups(): Promise<StudentGroupMap> {
    if (!this.isLoaded) {
      await this.init();
    }
    return { ...this.groups };
  }

  public async getGroup(id: string): Promise<StudentGroup | null> {
    if (!this.isLoaded) {
      await this.init();
    }
    return this.groups[id] ? JSON.parse(JSON.stringify(this.groups[id])) : null;
  }

  public async saveGroup(group: StudentGroup): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const existing = this.groups[group.id];
    let mergedStudents = group.students;

    if (existing && existing.students) {
      const existingMap = new Map(existing.students.map((s) => [s.id, s]));
      mergedStudents = group.students.map((newStudent) => {
        const oldStudent = existingMap.get(newStudent.id);
        if (oldStudent) {
          return {
            ...newStudent,
            meetOriginalName: newStudent.meetOriginalName || oldStudent.meetOriginalName,
            shortAlias: newStudent.shortAlias || oldStudent.shortAlias,
          };
        }
        return newStudent;
      });
    }

    this.groups[group.id] = {
      ...group,
      students: mergedStudents,
      updatedAt: Date.now(),
    };

    await this.persist();
    this.notifyListeners();
  }

  public async deleteGroup(id: string): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }
    delete this.groups[id];
    await this.persist();
    this.notifyListeners();
  }

  public async findGroupByTitle(callTitle: string): Promise<StudentGroup | null> {
    if (!callTitle || !callTitle.trim()) return null;
    if (!this.isLoaded) {
      await this.init();
    }

    const cleanTitle = callTitle.trim().toLowerCase();
    const groupList = Object.values(this.groups);

    // 1. Exact name match (case-insensitive)
    for (const group of groupList) {
      if (group.name.trim().toLowerCase() === cleanTitle) {
        return group;
      }
    }

    // 2. Substring match or Group ID match in call title
    for (const group of groupList) {
      const groupName = group.name.trim().toLowerCase();
      if (cleanTitle.includes(groupName) || groupName.includes(cleanTitle)) {
        return group;
      }
      if (cleanTitle.includes(group.id)) {
        return group;
      }
    }

    return null;
  }

  public async pairStudent(
    groupId: string,
    studentId: string,
    meetOriginalName: string,
    shortAlias?: string
  ): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const group = this.groups[groupId];
    if (!group) return;

    const student = group.students.find((s) => s.id === studentId);
    if (!student) return;

    student.meetOriginalName = meetOriginalName;
    if (shortAlias) {
      student.shortAlias = shortAlias;
    }
    group.updatedAt = Date.now();

    await this.persist();
    this.notifyListeners();
  }

  public async unpairStudent(groupId: string, studentId: string): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const group = this.groups[groupId];
    if (!group) return;

    const student = group.students.find((s) => s.id === studentId);
    if (!student) return;

    delete student.meetOriginalName;
    delete student.shortAlias;
    group.updatedAt = Date.now();

    await this.persist();
    this.notifyListeners();
  }

  public onUpdate(listener: (groups: StudentGroupMap) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const copy = { ...this.groups };
    for (const l of this.listeners) {
      try {
        l(copy);
      } catch (err) {
        console.error('[MeetSwitcher:GroupStore] Listener error:', err);
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.enableStorageSync || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      return;
    }

    try {
      await chrome.storage.sync.set({ [STORAGE_KEY_LMS_GROUPS]: this.groups });
    } catch (err) {
      console.warn('[MeetSwitcher:GroupStore] Failed saving to sync, trying local fallback:', err);
      try {
        await chrome.storage?.local?.set({ [STORAGE_KEY_LMS_GROUPS]: this.groups });
      } catch (localErr) {
        console.error('[MeetSwitcher:GroupStore] Storage save failed completely:', localErr);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/group-store.test.ts`
Expected: PASS with 4 tests passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/types/attendance.ts src/types/index.ts src/content/attendance/group-store.ts tests/group-store.test.ts
git commit -m "feat(attendance): add GroupStore and student group data schema"
```

---

### Task 2: Google Meet Call Title Detector (`CallTitleDetector`)

**Files:**
- Create: `src/content/attendance/title-detector.ts`
- Test: `tests/title-detector.test.ts`

**Interfaces:**
- Produces:
  - `CallTitleDetector`:
    - `extractTitle(root?: ParentNode): string | null`
    - `start(): void`
    - `stop(): void`
    - `getCurrentTitle(): string | null`
    - `onTitleChange(listener: (title: string) => void): () => void`

- [ ] **Step 1: Write the failing test for `CallTitleDetector`**

```ts
// tests/title-detector.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { CallTitleDetector } from '../src/content/attendance/title-detector.ts';

test('CallTitleDetector extracts title matching Google Meet user HTML snippet', () => {
  const detector = new CallTitleDetector();

  // Create mock DOM matching user provided snippet:
  // <div class="ND08le" jscontroller="CXNSjc">
  //   <div jsname="z7Oi7b" class="Cpvy4b NPmbie">
  //     <span class="uZ1Eue eQj9Ue">
  //       <div role="heading" aria-level="1" class="Qp8KI oFHBjb">
  //         <div class="uBRSj" tt-id="ucc-15">
  //           <button aria-label="Meeting details">
  //             <div jsname="NeC6gb" class="u6vdEc ouH3xe">УКР_Гейм_ЧТ_19:00</div>
  //           </button>
  //         </div>
  //       </div>
  //     </span>
  //   </div>
  // </div>
  const mockTitleEl = {
    textContent: 'УКР_Гейм_ЧТ_19:00',
    getAttribute: (k: string) => (k === 'jsname' ? 'NeC6gb' : null),
  };

  const mockRoot = {
    querySelector: (sel: string) => {
      if (sel.includes('NeC6gb') || sel.includes('u6vdEc') || sel.includes('heading')) {
        return mockTitleEl;
      }
      return null;
    },
  } as any;

  const title = detector.extractTitle(mockRoot);
  assert.equal(title, 'УКР_Гейм_ЧТ_19:00');
});

test('CallTitleDetector falls back to tooltip element if main title is not ready', () => {
  const detector = new CallTitleDetector();

  const mockTooltip = {
    textContent: '  УКР_Гейм_ЧТ_19:00  ',
  };

  const mockRoot = {
    querySelector: (sel: string) => {
      if (sel.includes('tooltip')) {
        return mockTooltip;
      }
      return null;
    },
  } as any;

  const title = detector.extractTitle(mockRoot);
  assert.equal(title, 'УКР_Гейм_ЧТ_19:00');
});

test('CallTitleDetector filters out generic UI button labels and empty strings', () => {
  const detector = new CallTitleDetector();

  const mockInvalid = {
    textContent: 'Meeting details',
  };
  const mockRoot = {
    querySelector: () => mockInvalid,
  } as any;

  // Generic meeting details string should be ignored
  const title = detector.extractTitle(mockRoot);
  assert.equal(title, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/title-detector.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `src/content/attendance/title-detector.ts`**

```ts
// src/content/attendance/title-detector.ts

export class CallTitleDetector {
  private currentTitle: string | null = null;
  private observer: MutationObserver | null = null;
  private pollTimer: any = null;
  private listeners: Array<(title: string) => void> = [];

  // Verified selectors from Google Meet DOM
  private static readonly TITLE_SELECTORS = [
    'div[role="heading"] [jsname="NeC6gb"].u6vdEc',
    '[jsname="NeC6gb"].u6vdEc',
    'div[role="heading"] .u6vdEc',
    '.ND08le .u6vdEc',
    '.EY8ABd-OWXEXe-TAWMXe[role="tooltip"]',
    'div[role="heading"][aria-level="1"] button div',
  ];

  private static readonly IGNORED_STRINGS = new Set([
    '',
    'meeting details',
    'деталі зустрічі',
    'детали встречи',
    'meet',
    'google meet',
  ]);

  public extractTitle(root: ParentNode = document): string | null {
    for (const selector of CallTitleDetector.TITLE_SELECTORS) {
      try {
        const el = root.querySelector(selector);
        if (el && el.textContent) {
          const raw = el.textContent.trim();
          if (raw && !CallTitleDetector.IGNORED_STRINGS.has(raw.toLowerCase())) {
            return raw;
          }
        }
      } catch {
        // Ignore selector errors on non-standard mock roots
      }
    }
    return null;
  }

  public getCurrentTitle(): string | null {
    return this.currentTitle;
  }

  public start(): void {
    if (typeof document === 'undefined') return;

    this.checkTitle();

    if (typeof MutationObserver !== 'undefined') {
      this.observer = new MutationObserver(() => {
        this.checkTitle();
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    // Polling backup for dynamically loaded titles
    this.pollTimer = setInterval(() => {
      this.checkTitle();
    }, 2000);
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public onTitleChange(listener: (title: string) => void): () => void {
    this.listeners.push(listener);
    if (this.currentTitle) {
      listener(this.currentTitle);
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private checkTitle(): void {
    const detected = this.extractTitle();
    if (detected && detected !== this.currentTitle) {
      this.currentTitle = detected;
      for (const listener of this.listeners) {
        try {
          listener(detected);
        } catch (err) {
          console.error('[MeetSwitcher:CallTitleDetector] Listener error:', err);
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/title-detector.test.ts`
Expected: PASS with 3 tests passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/content/attendance/title-detector.ts tests/title-detector.test.ts
git commit -m "feat(attendance): add Google Meet call title detector"
```

---

### Task 3: Attendance Presence Tracker & Report Formatter (`AttendanceTracker`)

**Files:**
- Create: `src/content/attendance/attendance-tracker.ts`
- Test: `tests/attendance-tracker.test.ts`

**Interfaces:**
- Produces:
  - `AttendanceStatusItem`: `{ student: GroupStudent; isPresent: boolean; isManualOverride: boolean; matchedBy?: string; }`
  - `AttendanceTracker`:
    - `computeAttendance(group: StudentGroup, activeNames: string[]): AttendanceStatusItem[]`
    - `setManualOverride(studentId: string, isPresent: boolean | null): void`
    - `formatManagerReport(group: StudentGroup, items: AttendanceStatusItem[]): string`

- [ ] **Step 1: Write the failing test for `AttendanceTracker`**

```ts
// tests/attendance-tracker.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceTracker } from '../src/content/attendance/attendance-tracker.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

const mockGroup: StudentGroup = {
  id: '2595601',
  name: 'УКР_Гейм_ЧТ_19:00',
  lmsUrl: 'https://lms.alg.academy/group/view/2595601#group-student-grid',
  updatedAt: Date.now(),
  students: [
    {
      id: '6753930',
      fullName: 'Альфелді Камалія',
      lmsUrl: 'https://lms.alg.academy/student/update/6753930',
      meetOriginalName: 'Iryna Alfeldi',
      shortAlias: 'Камалія',
    },
    {
      id: '6753283',
      fullName: 'Воронченко Віра',
      lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      meetOriginalName: 'Vira Voronchenko',
      shortAlias: 'Віра',
    },
    {
      id: '6751389',
      fullName: 'Євтушенко Ярослав',
      lmsUrl: 'https://lms.alg.academy/student/update/6751389',
      // No Meet binding yet
    },
  ],
};

test('AttendanceTracker correctly marks present students by meetOriginalName or alias', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi', 'Teacher Name'];

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  
  const kamaliya = items.find((i) => i.student.id === '6753930');
  assert.ok(kamaliya);
  assert.equal(kamaliya.isPresent, true);

  const vira = items.find((i) => i.student.id === '6753283');
  assert.ok(vira);
  assert.equal(vira.isPresent, false);

  const yaroslav = items.find((i) => i.student.id === '6751389');
  assert.ok(yaroslav);
  assert.equal(yaroslav.isPresent, false);
});

test('AttendanceTracker respects manual override over automatic detection', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi'];

  // Manually mark Yaroslav as present
  tracker.setManualOverride('6751389', true);

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  const yaroslav = items.find((i) => i.student.id === '6751389');
  assert.ok(yaroslav);
  assert.equal(yaroslav.isPresent, true);
  assert.equal(yaroslav.isManualOverride, true);

  // Clear manual override
  tracker.setManualOverride('6751389', null);
  const recomputed = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  assert.equal(recomputed.find((i) => i.student.id === '6751389')?.isPresent, false);
});

test('AttendanceTracker formats manager report strictly matching spec format', () => {
  const tracker = new AttendanceTracker();
  const activeMeetParticipants = ['Iryna Alfeldi', 'Vira Voronchenko'];

  const items = tracker.computeAttendance(mockGroup, activeMeetParticipants);
  const report = tracker.formatManagerReport(mockGroup, items);

  const expectedLines = [
    'Альфелді Камалія (https://lms.alg.academy/student/update/6753930) (Iryna Alfeldi) +',
    'Воронченко Віра (https://lms.alg.academy/student/update/6753283) (Vira Voronchenko) +',
    'Євтушенко Ярослав (https://lms.alg.academy/student/update/6751389) (не прив\'язано) -',
  ];

  assert.equal(report, expectedLines.join('\n'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/attendance-tracker.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `src/content/attendance/attendance-tracker.ts`**

```ts
// src/content/attendance/attendance-tracker.ts
import type { GroupStudent, StudentGroup } from '../../types/attendance.ts';

export interface AttendanceStatusItem {
  student: GroupStudent;
  isPresent: boolean;
  isManualOverride: boolean;
  matchedBy?: string;
}

export class AttendanceTracker {
  private manualOverrides: Map<string, boolean> = new Map();

  public setManualOverride(studentId: string, isPresent: boolean | null): void {
    if (isPresent === null) {
      this.manualOverrides.delete(studentId);
    } else {
      this.manualOverrides.set(studentId, isPresent);
    }
  }

  public clearOverrides(): void {
    this.manualOverrides.clear();
  }

  public computeAttendance(group: StudentGroup, activeNames: string[]): AttendanceStatusItem[] {
    const normalizedActive = new Set(
      activeNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    );

    return group.students.map((student) => {
      // 1. Check manual override first
      if (this.manualOverrides.has(student.id)) {
        return {
          student,
          isPresent: this.manualOverrides.get(student.id)!,
          isManualOverride: true,
          matchedBy: 'manual',
        };
      }

      // 2. Automatic matching by meetOriginalName, shortAlias, or fullName
      let isPresent = false;
      let matchedBy: string | undefined;

      const candidates = [
        student.meetOriginalName,
        student.shortAlias,
        student.fullName,
      ].filter((c): c is string => Boolean(c && c.trim()));

      for (const candidate of candidates) {
        const clean = candidate.trim().toLowerCase();
        if (normalizedActive.has(clean)) {
          isPresent = true;
          matchedBy = candidate;
          break;
        }

        // Substring / word match for partial names (e.g. "Iryna Alfeldi" vs "Alfeldi")
        for (const active of normalizedActive) {
          if (active.includes(clean) || clean.includes(active)) {
            isPresent = true;
            matchedBy = candidate;
            break;
          }
        }
        if (isPresent) break;
      }

      return {
        student,
        isPresent,
        isManualOverride: false,
        matchedBy,
      };
    });
  }

  public formatManagerReport(group: StudentGroup, items: AttendanceStatusItem[]): string {
    // Sort items alphabetically by student full name
    const sorted = [...items].sort((a, b) =>
      a.student.fullName.localeCompare(b.student.fullName, 'uk')
    );

    return sorted
      .map((item) => {
        const name = item.student.fullName;
        const link = item.student.lmsUrl;
        const meetAcc = item.student.meetOriginalName || "не прив'язано";
        const sign = item.isPresent ? '+' : '-';
        return `${name} (${link}) (${meetAcc}) ${sign}`;
      })
      .join('\n');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/attendance-tracker.test.ts`
Expected: PASS with 3 tests passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/content/attendance/attendance-tracker.ts tests/attendance-tracker.test.ts
git commit -m "feat(attendance): add AttendanceTracker and manager report formatter"
```

---

### Task 4: LMS Parser, Importer Content Script & Build Pipeline

**Files:**
- Create: `src/lms/parser.ts`
- Create: `src/lms/index.ts`
- Modify: `scripts/build.js`
- Modify: `manifest.json`
- Test: `tests/lms-parser.test.ts`

**Interfaces:**
- Produces:
  - `src/lms/parser.ts`:
    - `parseLmsGroupPage(doc: ParentNode, pageUrl: string): StudentGroup | null`
  - `src/lms/index.ts`:
    - Content script on `https://lms.alg.academy/*` injecting button `📥 Імпортувати в MeetSwitcher`
  - `dist/lms.js`: Built extension script

- [ ] **Step 1: Write the failing test for `parseLmsGroupPage`**

```ts
// tests/lms-parser.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLmsGroupPage } from '../src/lms/parser.ts';

test('parseLmsGroupPage extracts group name, id, and students from user DOM snippet', () => {
  // Simulating user snippet:
  // <div id="group-view" data-id="2595601">
  //   <div class="EditableArea GroupCard__header__title">
  //     <div class="EditableArea__input">УКР_Гейм_ЧТ_19:00</div>
  //   </div>
  //   <div id="group-student-grid">
  //     <div class="GroupStudent__list">
  //       <span class="permission-link GroupStudent__item__name">
  //         <a href="/student/update/6753930" target="_blank">Альфелді Камалія</a>
  //       </span>
  //       <span class="permission-link GroupStudent__item__name">
  //         <a href="/student/update/6753283" target="_blank">Воронченко Віра</a>
  //       </span>
  //     </div>
  //   </div>
  // </div>

  const links = [
    {
      getAttribute: (k: string) => (k === 'href' ? '/student/update/6753930' : null),
      textContent: ' Альфелді Камалія ',
    },
    {
      getAttribute: (k: string) => (k === 'href' ? 'https://lms.alg.academy/student/update/6753283' : null),
      textContent: 'Воронченко Віра',
    },
  ];

  const titleEl = { textContent: '  УКР_Гейм_ЧТ_19:00  ' };
  const rootEl = {
    getAttribute: (k: string) => (k === 'data-id' ? '2595601' : null),
  };

  const mockDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('EditableArea__input') || sel.includes('GroupCard__header__title')) {
        return titleEl;
      }
      if (sel.includes('#group-view')) {
        return rootEl;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('/student/update/')) {
        return links;
      }
      return [];
    },
  } as any;

  const group = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/group/view/2595601#group-student-grid');

  assert.ok(group);
  assert.equal(group.id, '2595601');
  assert.equal(group.name, 'УКР_Гейм_ЧТ_19:00');
  assert.equal(group.students.length, 2);
  assert.equal(group.students[0].id, '6753930');
  assert.equal(group.students[0].fullName, 'Альфелді Камалія');
  assert.equal(group.students[0].lmsUrl, 'https://lms.alg.academy/student/update/6753930');
  assert.equal(group.students[1].id, '6753283');
  assert.equal(group.students[1].fullName, 'Воронченко Віра');
});

test('parseLmsGroupPage handles missing elements gracefully', () => {
  const mockDoc = {
    querySelector: () => null,
    querySelectorAll: () => [],
  } as any;

  const result = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/other/page');
  assert.equal(result, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/lms-parser.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `src/lms/parser.ts` and `src/lms/index.ts`**

```ts
// src/lms/parser.ts
import type { StudentGroup, GroupStudent } from '../types/attendance.ts';

export function parseLmsGroupPage(doc: ParentNode, pageUrl: string): StudentGroup | null {
  // 1. Extract Group ID from URL or #group-view[data-id]
  let groupId: string | null = null;
  const urlMatch = pageUrl.match(/\/group\/view\/(\d+)/);
  if (urlMatch) {
    groupId = urlMatch[1];
  } else {
    const rootEl = doc.querySelector('#group-view');
    if (rootEl) {
      groupId = rootEl.getAttribute('data-id');
    }
  }

  if (!groupId) {
    return null;
  }

  // 2. Extract Group Name
  const titleEl = doc.querySelector(
    '.GroupCard__header__title .EditableArea__input, .GroupCard__header__title, #group-view h1, #group-view .page-title'
  );
  const groupName = titleEl?.textContent?.trim() || `Група ${groupId}`;

  // 3. Extract Students from #group-student-grid
  const studentLinks = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('#group-student-grid a[href*="/student/update/"], a[href*="/student/update/"]')
  );

  const seenIds = new Set<string>();
  const students: GroupStudent[] = [];

  for (const link of studentLinks) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/student\/update\/(\d+)/);
    if (!match) continue;

    const studentId = match[1];
    if (seenIds.has(studentId)) continue;
    seenIds.add(studentId);

    const fullName = link.textContent?.trim() || `Учень ${studentId}`;
    const lmsUrl = href.startsWith('http')
      ? href
      : `https://lms.alg.academy/student/update/${studentId}`;

    students.push({
      id: studentId,
      fullName,
      lmsUrl,
    });
  }

  if (students.length === 0 && !doc.querySelector('#group-student-grid')) {
    return null;
  }

  return {
    id: groupId,
    name: groupName,
    lmsUrl: pageUrl,
    students,
    updatedAt: Date.now(),
  };
}
```

Now create `src/lms/index.ts`:
```ts
// src/lms/index.ts
import { parseLmsGroupPage } from './parser.ts';
import { GroupStore } from '../content/attendance/group-store.ts';

const store = GroupStore.getInstance();

function injectImportButton(): void {
  // Check if button already injected
  if (document.getElementById('meet-switcher-lms-btn')) {
    return;
  }

  // Target container from user DOM snippet
  const container = document.querySelector(
    '#group-student-grid .panel-heading .group-students .col-sm-12, #group-student-grid .panel-heading, #group-student-grid'
  );

  if (!container) {
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'meet-switcher-lms-btn';
  btn.type = 'button';
  btn.className = 'btn btn-success group-students__btn';
  btn.style.marginLeft = '8px';
  btn.style.fontWeight = '600';
  btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  btn.innerHTML = '📥 Імпортувати в MeetSwitcher';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '⏳ Імпортуємо...';

    try {
      const group = parseLmsGroupPage(document, window.location.href);
      if (!group) {
        alert('Не вдалося знайти таблицю учнів (#group-student-grid). Перевірте вкладку групи.');
        btn.disabled = false;
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
        return;
      }

      await store.saveGroup(group);

      btn.style.background = '#28a745';
      btn.innerHTML = `✅ Імпортовано ${group.students.length} учнів!`;
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
      }, 3500);
    } catch (err) {
      console.error('[MeetSwitcher:LMS] Import failed:', err);
      btn.disabled = false;
      btn.innerHTML = '❌ Помилка імпорту';
      setTimeout(() => {
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
      }, 3000);
    }
  });

  container.appendChild(btn);
}

// Observe DOM mutations to inject button when tabs change
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectImportButton();
  });
} else {
  injectImportButton();
}

const observer = new MutationObserver(() => {
  injectImportButton();
});
observer.observe(document.body, { childList: true, subtree: true });
```

Now update `scripts/build.js` to build `lms.js` as IIFE, and update `manifest.json`.
In `scripts/build.js`:
```js
  // Add LMS content script build step
  await build({
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      watch: isWatch ? {} : null,
      lib: {
        entry: path.resolve('src/lms/index.ts'),
        name: 'MeetSwitcherLMS',
        formats: ['iife'],
        fileName: () => 'lms.js',
      },
    },
  });
```

In `manifest.json`:
Add `"https://lms.alg.academy/*"` to `host_permissions` and content script entry:
```json
    {
      "matches": ["https://lms.alg.academy/*"],
      "js": ["lms.js"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/lms-parser.test.ts`
Expected: PASS with 2 tests passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/lms/parser.ts src/lms/index.ts scripts/build.js manifest.json tests/lms-parser.test.ts
git commit -m "feat(lms): add LMS student grid parser, importer button, and build step"
```

---

### Task 5: Attendance Modal UI (`AttendanceModal`)

**Files:**
- Create: `src/content/ui/attendance-modal.ts`
- Modify: `src/content/ui/styles.css`
- Test: `tests/attendance-modal.test.ts`

**Interfaces:**
- Produces:
  - `AttendanceModal`:
    - `open(group?: StudentGroup): void`
    - `close(): void`
    - `isOpen(): boolean`
    - `update(activeNames: string[]): void`
    - `setSelectedGroup(groupId: string): void`

- [ ] **Step 1: Write the failing test for `AttendanceModal`**

```ts
// tests/attendance-modal.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceModal } from '../src/content/ui/attendance-modal.ts';
import { GroupStore } from '../src/content/attendance/group-store.ts';
import type { StudentGroup } from '../src/types/attendance.ts';

test('AttendanceModal renders groups, stats, and student rows', async () => {
  const store = new GroupStore({ enableStorageSync: false });
  const sampleGroup: StudentGroup = {
    id: '2595601',
    name: 'УКР_Гейм_ЧТ_19:00',
    lmsUrl: 'https://lms.alg.academy/group/view/2595601',
    updatedAt: Date.now(),
    students: [
      {
        id: '6753930',
        fullName: 'Альфелді Камалія',
        lmsUrl: 'https://lms.alg.academy/student/update/6753930',
        meetOriginalName: 'Iryna Alfeldi',
      },
      {
        id: '6753283',
        fullName: 'Воронченко Віра',
        lmsUrl: 'https://lms.alg.academy/student/update/6753283',
      },
    ],
  };
  await store.saveGroup(sampleGroup);

  // Mock ShadowRoot host
  const children: any[] = [];
  const mockShadow = {
    appendChild: (child: any) => children.push(child),
    querySelector: (sel: string) => null,
  } as any;

  const modal = new AttendanceModal(mockShadow, store);
  assert.equal(modal.isOpen(), false);

  modal.open(sampleGroup);
  assert.equal(modal.isOpen(), true);

  modal.update(['Iryna Alfeldi']);
  modal.close();
  assert.equal(modal.isOpen(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/attendance-modal.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement `src/content/ui/attendance-modal.ts` and styling**

```ts
// src/content/ui/attendance-modal.ts
import { GroupStore } from '../attendance/group-store.ts';
import { AttendanceTracker, AttendanceStatusItem } from '../attendance/attendance-tracker.ts';
import type { StudentGroup } from '../../types/attendance.ts';

export class AttendanceModal {
  private shadow: ShadowRoot;
  private store: GroupStore;
  private tracker: AttendanceTracker;
  private overlayEl!: HTMLElement;
  private isVisible = false;
  private activeGroup: StudentGroup | null = null;
  private currentActiveNames: string[] = [];
  private onPairAccountRequested?: (studentId: string) => void;

  constructor(shadow: ShadowRoot, store: GroupStore = GroupStore.getInstance()) {
    this.shadow = shadow;
    this.store = store;
    this.tracker = new AttendanceTracker();
    this.buildModal();
  }

  public isOpen(): boolean {
    return this.isVisible;
  }

  public open(group?: StudentGroup): void {
    if (group) {
      this.activeGroup = group;
    }
    this.isVisible = true;
    this.overlayEl.classList.add('active');
    this.render();
  }

  public close(): void {
    this.isVisible = false;
    this.overlayEl.classList.remove('active');
  }

  public update(activeNames: string[]): void {
    this.currentActiveNames = activeNames;
    if (this.isVisible) {
      this.render();
    }
  }

  public async setSelectedGroup(groupId: string): Promise<void> {
    const group = await this.store.getGroup(groupId);
    if (group) {
      this.activeGroup = group;
      this.tracker.clearOverrides();
      this.render();
    }
  }

  private buildModal(): void {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'attendance-modal-overlay';
    this.overlayEl.innerHTML = `
      <div class="attendance-dialog">
        <div class="attendance-header">
          <div class="attendance-title-wrap">
            <span class="attendance-icon">📋</span>
            <span class="attendance-title">Відвідуваність</span>
            <select class="attendance-group-select"></select>
          </div>
          <button class="attendance-close-btn" title="Закрити (Esc)">✕</button>
        </div>
        <div class="attendance-stats">
          <span class="stat-present">🟢 Присутні: <b class="stat-present-count">0</b></span>
          <span class="stat-absent">🔴 Відсутні: <b class="stat-absent-count">0</b></span>
          <span class="stat-total">Всього: <b class="stat-total-count">0</b></span>
        </div>
        <div class="attendance-body">
          <div class="attendance-list"></div>
        </div>
        <div class="attendance-footer">
          <button class="attendance-copy-btn">
            📋 Скопіювати для менеджера
          </button>
        </div>
      </div>
    `;

    this.shadow.appendChild(this.overlayEl);

    // Event listeners
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    const closeBtn = this.overlayEl.querySelector('.attendance-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    const groupSelect = this.overlayEl.querySelector<HTMLSelectElement>('.attendance-group-select');
    groupSelect?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val) {
        this.setSelectedGroup(val);
      }
    });

    const copyBtn = this.overlayEl.querySelector<HTMLButtonElement>('.attendance-copy-btn');
    copyBtn?.addEventListener('click', () => this.copyReport());
  }

  private async render(): Promise<void> {
    const allGroups = await this.store.getAllGroups();
    const groupList = Object.values(allGroups);

    const selectEl = this.overlayEl.querySelector<HTMLSelectElement>('.attendance-group-select');
    if (selectEl) {
      selectEl.innerHTML = '';
      if (groupList.length === 0) {
        selectEl.innerHTML = '<option value="">Немає імпортованих груп (відкрийте LMS)</option>';
      } else {
        for (const g of groupList) {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          if (this.activeGroup && this.activeGroup.id === g.id) {
            opt.selected = true;
          }
          selectEl.appendChild(opt);
        }
      }
    }

    if (!this.activeGroup && groupList.length > 0) {
      this.activeGroup = groupList[0];
    }

    const listEl = this.overlayEl.querySelector<HTMLElement>('.attendance-list');
    const presentCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-present-count');
    const absentCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-absent-count');
    const totalCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-total-count');

    if (!listEl) return;

    if (!this.activeGroup || this.activeGroup.students.length === 0) {
      listEl.innerHTML = `
        <div class="attendance-empty">
          <p>У цій групі ще немає учнів або група не вибрана.</p>
          <p style="font-size: 11px; opacity: 0.7; margin-top: 4px;">
            Перейдіть на сторінку групи в LMS та натисніть «📥 Імпортувати в MeetSwitcher».
          </p>
        </div>
      `;
      if (presentCountEl) presentCountEl.textContent = '0';
      if (absentCountEl) absentCountEl.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      return;
    }

    const items = this.tracker.computeAttendance(this.activeGroup, this.currentActiveNames);
    const presentCount = items.filter((i) => i.isPresent).length;
    const absentCount = items.length - presentCount;

    if (presentCountEl) presentCountEl.textContent = String(presentCount);
    if (absentCountEl) absentCountEl.textContent = String(absentCount);
    if (totalCountEl) totalCountEl.textContent = String(items.length);

    listEl.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `attendance-row ${item.isPresent ? 'is-present' : 'is-absent'}`;

      row.innerHTML = `
        <button class="status-toggle-btn ${item.isPresent ? 'status-plus' : 'status-minus'}" title="Клікніть для зміни статусу (+ / -)">
          ${item.isPresent ? '+' : '−'}
        </button>
        <div class="student-info">
          <div class="student-name-row">
            <span class="student-fullname">${item.student.fullName}</span>
            <a href="${item.student.lmsUrl}" target="_blank" class="student-lms-link" title="Відкрити картку в LMS">↗</a>
          </div>
          <div class="student-meet-meta">
            ${
              item.student.meetOriginalName
                ? `<span class="paired-acc" title="Прив'язаний Google-акаунт">👤 ${item.student.meetOriginalName}</span>`
                : `<span class="unpaired-acc">⚠️ не прив'язано</span>`
            }
            ${item.isManualOverride ? '<span class="manual-tag">ручне</span>' : ''}
          </div>
        </div>
      `;

      const toggleBtn = row.querySelector<HTMLButtonElement>('.status-toggle-btn');
      toggleBtn?.addEventListener('click', () => {
        this.tracker.setManualOverride(item.student.id, !item.isPresent);
        this.render();
      });

      listEl.appendChild(row);
    }
  }

  private async copyReport(): Promise<void> {
    if (!this.activeGroup) return;

    const items = this.tracker.computeAttendance(this.activeGroup, this.currentActiveNames);
    const text = this.tracker.formatManagerReport(this.activeGroup, items);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      const copyBtn = this.overlayEl.querySelector<HTMLButtonElement>('.attendance-copy-btn');
      if (copyBtn) {
        const orig = copyBtn.innerHTML;
        copyBtn.innerHTML = '✅ Скопійовано для менеджера!';
        copyBtn.style.background = '#28a745';
        setTimeout(() => {
          copyBtn.innerHTML = orig;
          copyBtn.style.background = '';
        }, 2000);
      }
    } catch (err) {
      console.error('[MeetSwitcher:AttendanceModal] Failed to copy to clipboard:', err);
    }
  }
}
```

Add modal styles to `src/content/ui/styles.css`:
```css
/* ===================================================
   Attendance Modal Overlay Styles
   =================================================== */

.attendance-modal-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(13, 14, 18, 0.85);
  backdrop-filter: blur(10px);
  z-index: 10000001;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.attendance-modal-overlay.active {
  opacity: 1;
  pointer-events: auto;
}

.attendance-dialog {
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
  background: #202124;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.attendance-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #2d2e30;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  gap: 10px;
}

.attendance-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.attendance-title {
  font-weight: 700;
  font-size: 14px;
  color: #fff;
  white-space: nowrap;
}

.attendance-group-select {
  flex: 1;
  background: #18191d;
  color: #e8eaed;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
  min-width: 140px;
  text-overflow: ellipsis;
}

.attendance-close-btn {
  background: transparent;
  border: none;
  color: #9aa0a6;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.attendance-close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.attendance-stats {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.stat-present { color: #81c995; }
.stat-absent { color: #f28b82; }
.stat-total { color: #9aa0a6; }

.attendance-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
  max-height: 50vh;
}

.attendance-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.15s ease;
}

.attendance-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.status-toggle-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  font-weight: 800;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.status-plus {
  background: #1e4620;
  color: #81c995;
}

.status-plus:hover {
  background: #2e6630;
}

.status-minus {
  background: #3c4043;
  color: #9aa0a6;
}

.status-minus:hover {
  background: #5f6368;
  color: #f28b82;
}

.student-info {
  flex: 1;
  min-width: 0;
}

.student-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.student-fullname {
  font-weight: 600;
  color: #e8eaed;
  font-size: 13px;
}

.student-lms-link {
  color: #8ab4f8;
  text-decoration: none;
  font-size: 12px;
}

.student-lms-link:hover {
  text-decoration: underline;
}

.student-meet-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
}

.paired-acc {
  color: #8ab4f8;
}

.unpaired-acc {
  color: #fdd663;
}

.manual-tag {
  background: rgba(255, 255, 255, 0.1);
  padding: 1px 4px;
  border-radius: 4px;
  color: #9aa0a6;
}

.attendance-footer {
  padding: 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: #28292c;
  display: flex;
  justify-content: flex-end;
}

.attendance-copy-btn {
  background: #1a73e8;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.attendance-copy-btn:hover {
  background: #185abc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/attendance-modal.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/content/ui/attendance-modal.ts src/content/ui/styles.css tests/attendance-modal.test.ts
git commit -m "feat(ui): add AttendanceModal component and dark-theme styles"
```

---

### Task 6: HUD Button Integration & Main Content Script Wiring

**Files:**
- Modify: `src/content/ui/hud.ts`
- Modify: `src/content/index.ts`
- Test: `tests/hud-attendance.test.ts`

**Interfaces:**
- Produces:
  - HUD `.hud-actions` includes:
    `<button class="icon-btn attendance-btn" title="Відвідуваність уроку">📋</button>`
  - Wire `CallTitleDetector` on call load to match group and notify `AttendanceModal`.
  - Wire `attendance-btn` click to toggle `AttendanceModal`.

- [ ] **Step 1: Write the failing test for HUD attendance button**

```ts
// tests/hud-attendance.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { SwitcherHud } from '../src/content/ui/hud.ts';

test('SwitcherHud has icon-only attendance button with title "Відвідуваність уроку"', () => {
  // Mock pin controller
  const controller = {} as any;
  const hud = new SwitcherHud(controller);
  const shadow = hud.getShadowRoot();

  const attendanceBtn = shadow.querySelector<HTMLButtonElement>('.attendance-btn');
  assert.ok(attendanceBtn);
  assert.equal(attendanceBtn.textContent?.trim(), '📋');
  assert.equal(attendanceBtn.title, 'Відвідуваність уроку');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/hud-attendance.test.ts`
Expected: FAIL (button missing in HUD skeleton)

- [ ] **Step 3: Modify `src/content/ui/hud.ts` and `src/content/index.ts`**

In `src/content/ui/hud.ts`:
Add handler:
```ts
  private onToggleAttendanceHandler?: () => void;

  public setOnToggleAttendance(handler: () => void): void {
    this.onToggleAttendanceHandler = handler;
  }
```

In `buildSkeleton()`:
```ts
        <div class="hud-actions">
          <button class="icon-btn speed-btn active" title="Турбо-режим активний: анімації Google Meet вимкнено (Alt + A)">⚡</button>
          <button class="btn-demo-pill" style="display: none;" title="Тестовий демо-режим: 9 учнів (Alt + Shift + D)">🧪 Демо</button>
          <button class="icon-btn wall-btn" title="Стіна класу / Огляд (Alt + W)">⊞</button>
          <button class="icon-btn attendance-btn" title="Відвідуваність уроку">📋</button>
          <button class="icon-btn toggle-btn" title="Згорнути / Розгорнути">─</button>
        </div>
```
And wire listener:
```ts
    const attendanceBtn = this.containerEl.querySelector<HTMLButtonElement>('.attendance-btn')!;
    attendanceBtn.addEventListener('click', () => {
      if (this.onToggleAttendanceHandler) {
        this.onToggleAttendanceHandler();
      }
    });
```

In `src/content/index.ts`:
```ts
import { GroupStore } from './attendance/group-store';
import { CallTitleDetector } from './attendance/title-detector';
import { AttendanceModal } from './ui/attendance-modal';
```
Initialize and wire:
```ts
  const groupStore = GroupStore.getInstance();
  await groupStore.init();

  const titleDetector = new CallTitleDetector();
  titleDetector.start();

  const attendanceModal = new AttendanceModal(hud.getShadowRoot(), groupStore);

  // Auto-match group when call title is detected
  titleDetector.onTitleChange(async (title) => {
    logger.log('SYSTEM', `Google Meet title detected: "${title}"`);
    const matched = await groupStore.findGroupByTitle(title);
    if (matched) {
      logger.log('SYSTEM', `Auto-matched group: "${matched.name}" (ID: ${matched.id})`);
      attendanceModal.setSelectedGroup(matched.id);
    }
  });

  hud.setOnToggleAttendance(() => {
    if (attendanceModal.isOpen()) {
      attendanceModal.close();
    } else {
      // Gather current participant names from active shares and detector
      const names = detector.getScreenShares().map((s) => s.participantName);
      attendanceModal.open();
      attendanceModal.update(names);
    }
  });

  // Keep attendance updated with incoming scans
  detector.onScan((shares) => {
    tileDecorator.updateBadges(shares);
    sidePanelDecorator.update();
    if (attendanceModal.isOpen()) {
      attendanceModal.update(shares.map((s) => s.participantName));
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/hud-attendance.test.ts`
Expected: PASS with 1 test passed.

- [ ] **Step 5: Commit changes**

```bash
git add src/content/ui/hud.ts src/content/index.ts tests/hud-attendance.test.ts
git commit -m "feat(hud): wire icon-only attendance button and Google Meet title auto-matching"
```

---

### Task 7: Full Verification, Test Suite & Extension Build

**Files:**
- Modify: `package.json` (add new tests to `npm test`)
- Run: `npm run typecheck`, `npm test`, `npm run build`

- [ ] **Step 1: Update `package.json` test script to include all new tests**

In `package.json`:
```json
"test": "node --test --experimental-strip-types tests/detector.test.ts tests/logger.test.ts tests/call-monitor.test.ts tests/alias-manager.test.ts tests/tile-badge.test.ts tests/side-panel-decorator.test.ts tests/pin-controller.test.ts tests/wall.test.ts tests/groups.test.ts tests/group-store.test.ts tests/title-detector.test.ts tests/attendance-tracker.test.ts tests/lms-parser.test.ts tests/attendance-modal.test.ts tests/hud-attendance.test.ts"
```

- [ ] **Step 2: Run all tests and typecheck**

Run: `npm test`
Expected: 100% pass across all tests (>75 tests).

Run: `npm run typecheck`
Expected: Clean exit with code 0 (no TypeScript errors).

- [ ] **Step 3: Run extension build**

Run: `npm run build`
Expected:
`dist/content.js`
`dist/background.js`
`dist/popup.js`
`dist/lms.js`
`dist/manifest.json`

- [ ] **Step 4: Commit final changes**

```bash
git add package.json
git commit -m "chore: include attendance tests in test suite and verify build"
```
