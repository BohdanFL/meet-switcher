# Pin Reliability, People Side-Panel Integration & Classroom Wall Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate "Tile not in DOM" errors by adding Google Meet "People" side-panel pinning, resolve stream duplication and phantom slots in ScreenDetector, and eliminate pitch-black screens in Classroom Wall.

**Architecture:** 
1. `PinController` is enhanced with a People side-panel pinning engine: fast-path pins visible tiles directly; if a tile is off-screen, it uses the always-present People sidebar ("Учасники") to pin the presentation reliably without failing.
2. `ScreenDetector` cleans up slot management: filters out system strings (e.g. "Everyone can see your annotations") and the teacher's own presentation ("Ваш екран (Ви)"), replaces dead slots when students reconnect, and decouples the center stage tile from slot 1.
3. `ClassroomWall` only displays live video for tiles active in the DOM; for off-screen/connecting shares, it displays a clean placeholder card instead of a black video stream, and gives Meet 400ms to mount video streams upon unpin.

**Tech Stack:** TypeScript, Google Chrome Extension Manifest V3, DOM MutationObserver, Node.js test runner (`node --test`).

## Global Constraints

- 100% backward-compatible with existing hotkeys (`Alt+1..9`, `Alt+0`, `Alt+W`, `Alt+A`, `Alt+Shift+D`).
- No UI lag or screen flicker during normal pinning.
- Must preserve support for students with multiple accounts/devices (e.g. "ЛЕОН" and "Леон").
- All code must pass `npm run typecheck` and `npm test` at every task boundary.

---

### Task 1: Filter System Strings & Teacher's Own Screen in ScreenDetector

**Files:**
- Modify: `src/content/detector.ts`
- Test: `tests/detector.test.ts`

**Interfaces:**
- `SYSTEM_NAME_PATTERNS`: extended RegExp array including annotation phrases.
- `isTeacherPresentation(name: string, tile: HTMLElement): boolean`: helper to detect teacher's own screen.
- `extractParticipantName`: ensures teacher's own presentation returns `'Ваш екран (Ви)'` and is excluded from `rawList`.

- [ ] **Step 1: Write failing tests in `tests/detector.test.ts`**

Add tests verifying:
1. `Everyone can see your annotations` and Ukrainian variants are rejected by `isValidParticipantName`.
2. Teacher's presentation (`Your presentation`, `Ваш екран (Ви)`, `Ви транслюєте екран`) is marked as teacher screen and excluded from student share list.

```typescript
test('Rejects annotation notice strings as participant names', () => {
  const detector = new ScreenDetector();
  assert.equal(detector.isValidParticipantName('Everyone can see your annotations'), false);
  assert.equal(detector.isValidParticipantName('Усі можуть бачити ваші анотації'), false);
  assert.equal(detector.isValidParticipantName('Try annotating'), false);
});

test('Identifies and filters out teacher own presentation from student shares', () => {
  const detector = new ScreenDetector();
  assert.equal(detector.isTeacherScreenName('Ваш екран (Ви)'), true);
  assert.equal(detector.isTeacherScreenName('Your presentation'), true);
  assert.equal(detector.isTeacherScreenName('Богдан Рубаха (Your Presentation)'), true);
  assert.equal(detector.isTeacherScreenName('Aleksey Priymak'), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/detector.test.ts`
Expected: FAIL (method `isTeacherScreenName` not found / annotation tests fail).

- [ ] **Step 3: Implement system string & teacher screen filtering in `src/content/detector.ts`**

1. Add annotation variants to `SYSTEM_NAME_PATTERNS`:
```typescript
  /everyone can see your annotations/i,
  /усі можуть бачити ваші анотації/i,
  /все могут видеть ваши аннотации/i,
```
2. Add public helper `isTeacherScreenName(name: string): boolean`:
```typescript
  public isTeacherScreenName(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.includes('ваш екран') ||
      lower.includes('ваша презентація') ||
      lower.includes('your presentation') ||
      lower.includes('ви транслюєте') ||
      lower.includes('you are presenting')
    );
  }
```
3. In `scan()`, exclude any tile where `this.isTeacherScreenName(participantName)` is true or `!this.isValidParticipantName(participantName)`:
```typescript
  if (this.isTeacherScreenName(participantName) || !this.isValidParticipantName(participantName)) {
    continue;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/detector.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck and commit**

```bash
npm run typecheck
git add src/content/detector.ts tests/detector.test.ts
git commit -m "feat(detector): filter annotation notices and teacher own screen from shares"
```

---

### Task 2: Deduplication, Slot Management & Reconnect Replacement in ScreenDetector

**Files:**
- Modify: `src/content/detector.ts`
- Test: `tests/detector.test.ts`

**Interfaces:**
- `rawList` scan consolidation: if an existing share in `knownShares` has the same participant and is currently `inDom: false`, replace the inactive entry with the newly active entry instead of creating a duplicate slot.
- Bounded retention: do not indefinitely freeze `lastSeenMap` during pinned mode if an entry has been missing from DOM for > 60s.
- Center stage decoupling: do not let stage video create an independent slot separate from its participant slot.

- [ ] **Step 1: Write failing unit test for slot deduplication**

Add test in `tests/detector.test.ts`:
Verify that when a student restarts their screen share and gets a new `device-id`, their existing slot index is updated with the new tile rather than adding a second slot with the same name.

```typescript
test('Replaces inactive participant share when new stream arrives instead of duplicating', () => {
  // Mock detector and verify knownShares maintains 1 slot per participant device
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement reconnect replacement and slot consolidation**

In `src/content/detector.ts`:
1. When matching `raw` against `knownShares`:
   - Match by `canonicalId === raw.id` OR match by `participantName` where the existing entry is `!isAvailableInDom`.
   - If an existing entry with the same participant name is marked `isAvailableInDom: false`, migrate its slot index to the new `raw.id` and delete the old dead ID from `knownShares`, `lastSeenMap`, and `participantSlots`.
2. Center stage tile:
   - If a tile is identified as the pinned center stage tile (`isTilePinned(tile)`), do not let it register a new independent participant if that participant is already accounted for in the grid/filmstrip.
3. Inactive pruning:
   - If `isAnyPinned` is true, prune entries that have been missing (`!inDom`) for > 90 seconds (do not reset `lastSeen` indefinitely every tick).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types tests/detector.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck and commit**

```bash
npm run typecheck
git add src/content/detector.ts tests/detector.test.ts
git commit -m "fix(detector): prevent duplicate slots on reconnect and consolidate inactive shares"
```

---

### Task 3: People Side-Panel Pinning Engine in PinController

**Files:**
- Modify: `src/content/pin-controller.ts`
- Test: `tests/pin-controller.test.ts` (create)

**Interfaces:**
- `isPeoplePanelOpen(): boolean`: detects if Google Meet People tab is currently active.
- `openPeoplePanel(): Promise<boolean>`: clicks the People button if closed.
- `pinViaPeoplePanel(participantName: string): Promise<boolean>`: searches/finds the presentation row for `participantName` in the side panel and clicks its Pin button.
- `switchToShare(target: ScreenShare)`:
  - If target tile is in DOM and visible: direct click (fast path <150ms).
  - If target tile is NOT in DOM: pin via People Side Panel (100% reliable fallback).

- [ ] **Step 1: Write failing unit test for People panel pinning helpers**

Create `tests/pin-controller.test.ts`:
Test `isPeoplePanelOpen`, `findPresentationInPeopleList`, and fallback dispatching when tile is not in DOM.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/pin-controller.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement People side-panel pinning in `src/content/pin-controller.ts`**

1. Add helper `isPeoplePanelOpen(doc: Document = document): boolean`:
```typescript
public isPeoplePanelOpen(doc: Document = document): boolean {
  const peopleBtn = doc.querySelector<HTMLButtonElement>(
    'button[aria-label*="People" i], button[aria-label*="учасник" i], button[aria-label*="люди" i], button[aria-label*="show everyone" i]'
  );
  if (peopleBtn && (peopleBtn.getAttribute('aria-pressed') === 'true' || peopleBtn.classList.contains('qs41qe'))) {
    return true;
  }
  return Boolean(doc.querySelector('div[role="tabpanel"][aria-label*="People" i], div[role="tabpanel"][aria-label*="Учасник" i], div[role="list"][aria-label*="Participants" i]'));
}
```

2. Add `openPeoplePanel(doc: Document = document): Promise<boolean>`:
```typescript
public async openPeoplePanel(doc: Document = document): Promise<boolean> {
  if (this.isPeoplePanelOpen(doc)) return true;
  const peopleBtn = doc.querySelector<HTMLButtonElement>(
    'button[aria-label*="People" i], button[aria-label*="учасник" i], button[aria-label*="люди" i], button[aria-label*="show everyone" i]'
  );
  if (!peopleBtn) return false;
  this.dispatchFullClick(peopleBtn);
  await this.sleep(250);
  return this.isPeoplePanelOpen(doc);
}
```

3. Add `pinViaPeoplePanel(participantName: string): Promise<boolean>`:
- Find list items in People panel (`div[role="listitem"]`).
- Locate the item matching the participant's presentation: text containing `participantName` AND (`presentation` or `презентація` or icon `present_to_all`).
- Hover the item to reveal buttons if needed.
- Click Pin button (`button[aria-label*="Pin" i]`, `button[aria-label*="Закріпити" i]`, `button[data-tooltip*="Pin" i]`).
- Handle host menu ("For myself only" / "Лише для мене") via `handlePinMenuIfOpened()`.

4. Wire into `switchToShare`:
- If `!isInDom`: call `await this.pinViaPeoplePanel(target.participantName)`. If successful, log and return true.
- Only if People panel pinning fails, fall back to global unpin and grid expansion.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/pin-controller.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck and commit**

```bash
npm run typecheck
git add src/content/pin-controller.ts tests/pin-controller.test.ts
git commit -m "feat(pin): add People side-panel pinning engine for 100% reliable switching"
```

---

### Task 4: Classroom Wall Black Screen Fix & Transition Delay

**Files:**
- Modify: `src/content/ui/wall.ts`
- Modify: `src/content/index.ts`
- Test: `tests/wall.test.ts` (create or update)

**Interfaces:**
- `ClassroomWall.render()`:
  - If `share.isAvailableInDom === false` or `share.videoElement?.srcObject === null`: render a clean student placeholder card with name, initials, and badge (`"🔄 Очікування відео..."`) instead of a broken black video tag.
  - When `share.videoElement` becomes active in DOM, smoothly attach `srcObject` and play.
- `index.ts`:
  - In `toggleWall`, increase wait time after `controller.unpin()` from 100ms to 400ms before `detector.scan()` and `wall.open()`.

- [ ] **Step 1: Write test verifying Classroom Wall video card handling**

Create `tests/wall.test.ts`:
Verify that Wall does not mount unplayable video elements when `isAvailableInDom: false` and instead renders an avatar/waiting state.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/wall.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement Classroom Wall placeholder & transition delay**

1. In `src/content/ui/wall.ts`:
   - Check if `share.videoElement && share.videoElement.srcObject && share.isAvailableInDom`.
   - If stream is active: append `<video autoplay muted playsinline>`.
   - If stream is inactive/off-screen: render clean placeholder:
     ```html
     <div class="wall-card-placeholder">
       <div class="wall-card-avatar">${initials}</div>
       <div class="wall-card-waiting">Очікування трансляції...</div>
     </div>
     ```
   - In `styles.css`: add styling for `.wall-card-placeholder`, `.wall-card-avatar`, `.wall-card-waiting`.
2. In `src/content/index.ts`:
   - In `toggleWall`: change `setTimeout/sleep` from `100` to `400` ms.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --experimental-strip-types tests/wall.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck and commit**

```bash
npm run typecheck
git add src/content/ui/wall.ts src/content/ui/styles.css src/content/index.ts tests/wall.test.ts
git commit -m "fix(wall): eliminate black screens with student placeholder cards and 400ms reflow delay"
```

---

### Task 5: Full Regression Testing & Extension Build

**Files:**
- Run test suite across all modules.
- Run extension build to update `dist/`.

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All tests pass (including existing and newly created tests).

- [ ] **Step 2: Run TypeScript typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Build extension**

Run: `npm run build`
Expected: Fresh bundle in `dist/`.

- [ ] **Step 4: Final verification and commit**

```bash
git status
git commit -am "chore: rebuild extension bundle with pin reliability and wall fixes"
```
