# Classroom Roster, HUD Dashboard & Multi-Pin Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform MeetSwitcher into a full Classroom Dashboard that displays active screen sharers (with stable 1..9 slots), students in call without screen sharing, absent group students, and guests; eliminate Google Meet Multi-Pin locking; and add hybrid all-attendee support to Classroom Wall.

**Architecture:**
1. `PinController` enforces **Exclusive Single-Pin Mode**: eliminates early `break` in `unpinActiveStreams()`, hovers with adequate delay for Meet animations, and unpins all other streams when switching so the stage is never clogged by multiple pins.
2. `RosterDetector` computes a unified `ClassroomRosterState` by reconciling active screen shares (`ScreenDetector`), all attendees in the call (`getActiveParticipantNames`), and the LMS roster (`GroupStore`).
3. `SwitcherHud` organizes participants into 3 distinct sections: 🟢 Active Sharers (1..9), 🟡 In Call Without Screen (collapsible, click pins camera, guest badges), and ⚪ Absent Students (dimmed, collapsed by default). Updates are reconciled in-place without `innerHTML = ''` to eliminate flicker.
4. `ClassroomWall` supports hybrid mode: default shows active presentations; toggle button reveals all attendees in call (with camera/avatar cards); live media streams are retained without blackouts.

**Tech Stack:** TypeScript, Google Chrome Extension Manifest V3, DOM MutationObserver, Vitest / Node.js test runner (`npm test`), Vite bundler.

## Global Constraints

- 100% backward-compatible with existing hotkeys (`Alt+1..9`, `Alt+0`, `Alt+W`, `Alt+A`, `Alt+Shift+D`).
- Slot numbers (1..9) are strictly reserved for active screen sharers and permanently booked per student across temporary toggles.
- Absent students must be visually muted (`opacity: 0.5`) and non-interactive.
- No UI lag, DOM flicker, or dropped clicks in HUD.
- All code must pass `npm test` and `npm run build` at every task boundary.

---

### Task 1: Fix Multi-Pin Accumulation & Robust Unpinning in PinController

**Files:**
- Modify: `src/content/pin-controller.ts`
- Test: `tests/pin-controller.test.ts`

**Interfaces:**
- `unpinActiveStreams(exceptTargetTile?: HTMLElement | null): Promise<void>`: unpins ALL pinned streams on stage and in People panel (no early break).
- `hoverTile(tile: HTMLElement): Promise<void>`: asynchronous hover with 40ms delay so Google Meet action overlay renders before button search.
- `switchToShare(target: ScreenShare)`: unpins all other pinned tiles (whether 1, 2, or 4) so only target is pinned.

- [ ] **Step 1: Write failing tests in `tests/pin-controller.test.ts`**

Add tests verifying:
1. `unpinActiveStreams` clicks ALL unpin buttons on stage, not just the first one.
2. `switchToShare` unpins all existing pinned streams when pinning a new target.
3. Multi-pin scenario: when 2 streams are pinned and target 3 is requested, both 1 and 2 are unpinned.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (only first unpin button was clicked due to `break;`, or signature mismatch).

- [ ] **Step 3: Implement multi-pin cleanup in `src/content/pin-controller.ts`**

1. Remove `break;` from `unpinActiveStreams()` so it iterates through all global buttons with unpin/keep_off.
2. In `switchToShare()`, iterate through all currently pinned shares and global unpin buttons, unpinning all of them except the target tile.
3. Add a small 40ms wait in `hoverTile` when searching for unpin buttons to allow Meet's hover animation to complete.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit changes**

`git commit -m "fix(pin): enforce exclusive single-pin mode and clean up multi-pin streams"`

---

### Task 2: Create RosterDetector & Unified Classroom State Engine

**Files:**
- Create: `src/content/attendance/roster-detector.ts`
- Create: `tests/roster-detector.test.ts`
- Modify: `src/types/index.ts`

**Interfaces:**
```typescript
export type RosterCategory = 'ACTIVE_SCREEN' | 'IN_CALL_NO_SCREEN' | 'GUEST' | 'ABSENT';

export interface RosterParticipant {
  id: string;
  name: string;
  category: RosterCategory;
  screenShare?: ScreenShare;
  tileElement?: HTMLElement | null;
  isGuest?: boolean;
}

export interface ClassroomRosterState {
  activeSharers: RosterParticipant[];
  inCallNoScreen: RosterParticipant[];
  guests: RosterParticipant[];
  absentStudents: RosterParticipant[];
}
```

- [ ] **Step 1: Write tests in `tests/roster-detector.test.ts`**

Test scenarios:
1. Student in LMS group and sharing screen -> classified as `ACTIVE_SCREEN`.
2. Student in LMS group present in call without screen -> classified as `IN_CALL_NO_SCREEN`.
3. Student in LMS group not present in call -> classified as `ABSENT`.
4. Attendee in call not in LMS group (e.g. manager, tutor) -> classified as `GUEST` with `isGuest: true`.
5. If no LMS group is loaded -> all attendees are split into `ACTIVE_SCREEN` and `IN_CALL_NO_SCREEN`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL (`roster-detector.ts` not found).

- [ ] **Step 3: Implement `RosterDetector` in `src/content/attendance/roster-detector.ts`**

1. Implement `reconcileRoster(shares: ScreenShare[], attendees: string[], groupStudents?: StudentRecord[]): ClassroomRosterState`.
2. Normalize names to match between Google Meet DOM, Ukrainian aliases, and LMS roster names.
3. Preserve stable slot numbers for active sharers using `ScreenDetector.participantNameToSlot`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit changes**

`git commit -m "feat(roster): implement RosterDetector for unified classroom attendee state"`

---

### Task 3: HUD Dashboard: 3 Collapsible Sections & Smart DOM Reconciliation

**Files:**
- Modify: `src/content/ui/hud.ts`
- Modify: `src/content/ui/hud-template.ts`
- Modify: `src/content/ui/styles.css`
- Test: `tests/hud.test.ts` (or add test cases in existing suite)

**Interfaces:**
- `hud.updateRoster(roster: ClassroomRosterState)`: renders the 3 sections with live counts.
- Collapsible section toggling: `toggleSection(sectionName: string)`.
- Storage persistence: `meet_switcher_hud_collapsed_sections`.
- Refresh button 🔄 in header: dispatches scan and updates roster.

- [ ] **Step 1: Write test for HUD roster rendering and state preservation**

Verify:
1. Renders 3 sections when group is active.
2. Clicking a student in "Без екрана" triggers camera/avatar tile pinning.
3. Absent students render with `.absent-item` and disabled interaction.
4. Collapsing a section updates storage and toggles class `.collapsed`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test`
Expected: FAIL (HUD does not have `updateRoster` or 3 sections).

- [ ] **Step 3: Implement HUD 3-section layout and in-place DOM reconciliation**

1. Update `hud-template.ts` and `styles.css` with:
   - Section headers: `.roster-section-header` with toggle arrow `▾` / `▸` and badge counter.
   - Distinct styles: `.item-screen`, `.item-no-screen`, `.item-absent` (opacity 0.5), `.badge-guest`.
   - Header refresh button: `.btn-refresh-roster` (🔄).
2. Update `hud.ts`:
   - Replace full `innerHTML = ''` re-renders with key-based element reconciliation.
   - Load and save collapsed section states from `chrome.storage.local`.
   - Wire click on `IN_CALL_NO_SCREEN` to pin the participant's camera/tile via `PinController`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit changes**

`git commit -m "feat(hud): add 3-section roster dashboard with in-place updates and camera pinning"`

---

### Task 4: Classroom Wall Hybrid Mode & Live MediaStream Retention

**Files:**
- Modify: `src/content/ui/wall.ts`
- Modify: `src/content/index.ts`
- Test: `tests/wall.test.ts`

**Interfaces:**
- `ClassroomWall.setShowAllAttendees(showAll: boolean)`: toggles showing active-only vs active+no-screen attendees.
- Header button: `wall-toggle-all-btn` ("Показати всіх у дзвінку").
- MediaStream retention: keeps playing live video stream across layout shifts.

- [ ] **Step 1: Write test for Wall hybrid mode and media stream persistence**

Verify:
1. Default Wall shows only active screens.
2. Enabling "Показати всіх у дзвінку" includes present students without screens (with avatar cards), but excludes absent students.
3. Card does not switch to placeholder if existing video element has active `MediaStream`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test`
Expected: FAIL (toggle not implemented).

- [ ] **Step 3: Implement Wall hybrid mode & multi-stage unpin expansion**

1. Add "Показати всіх у дзвінку" button to header in `wall.ts`.
2. When toggled, render `activeSharers` + `inCallNoScreen` attendees (excluding `absentStudents`).
3. In `index.ts`, run multi-stage scans (250, 400, 700 ms) upon unpinning for Wall, and subscribe `wall.updateShares` to every detector scan.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit changes**

`git commit -m "feat(wall): add hybrid attendee mode and persistent stream playback"`

---

### Task 5: End-to-End Integration, Build & Full Verification

**Files:**
- Modify: `src/content/index.ts`
- Run: `npm test`
- Run: `npm run build`

- [ ] **Step 1: Wire RosterDetector into index.ts**

1. Instantiate `RosterDetector`.
2. Connect DOM mutations and group store changes to `rosterDetector.reconcileRoster()`.
3. Pass reconciled state to `hud.updateRoster()`.
4. Connect HUD manual refresh button (🔄) to instant scan.

- [ ] **Step 2: Run entire test suite**

Run: `npm test`
Expected: All tests pass (91+ tests).

- [ ] **Step 3: Run extension production build**

Run: `npm run build`
Expected: Successful build with artifacts in `dist/`.

- [ ] **Step 4: Commit integration**

`git commit -m "feat: complete classroom roster dashboard and multi-pin resilience"`
