# Automatic Call Diagnostics & Post-Call Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automated, zero-distraction background diagnostic logging for Google Meet lessons, with automatic JSON export on call completion, persistent storage of recent sessions, and a toolbar popup for manual re-download.

**Architecture:** A lightweight `DiagnosticsLogger` captures structured events into a circular in-memory buffer and periodically syncs to `chrome.storage.local`. A `CallMonitor` tracks Meet call conclusion (red leave-call button, exit screen, or beforeunload) and automatically triggers a JSON download to the Downloads folder. A companion Chrome toolbar popup displays recent session summaries and provides one-click export buttons.

**Tech Stack:** TypeScript, Chrome Extensions Manifest V3 (`storage`, `downloads`), Vite build script, Node.js test runner.

## Global Constraints

- 100% passive during lessons: no dialogs, no interruptions, no UI friction for the teacher.
- Circular ring buffer: maximum 1000 events per session to prevent memory leaks during long calls.
- Rolling history: retains the last 5 sessions in `chrome.storage.local`.
- Privacy: 100% offline, local-first; no data transmitted to third-party endpoints.
- All code must pass `npm run typecheck` and `npm test` at every task boundary.

---

### Task 1: Diagnostics Data Models & Core Logger Engine

**Files:**
- Create: `src/diagnostics/types.ts`
- Create: `src/diagnostics/logger.ts`
- Create: `tests/logger.test.ts`

**Interfaces:**
- Produces: `DiagnosticsLogger` singleton, `LogEvent`, `SessionLog`, `DomSnapshot` types.
- Methods: `log(category, message, details?)`, `captureDomSnapshot(elements)`, `exportSessionJson()`, `persistToStorage()`, `getEvents()`.

- [ ] **Step 1: Write unit test for DiagnosticsLogger**

Create `tests/logger.test.ts` testing event recording, circular buffer overflow limit (max 1000), session summary calculation, and JSON export serialization.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/logger.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement types and DiagnosticsLogger**

Write `src/diagnostics/types.ts` and `src/diagnostics/logger.ts` implementing the ring buffer, event recording, DOM snapshot capture, and `chrome.storage.local` sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/logger.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/ tests/logger.test.ts
git commit -m "feat(diagnostics): add DiagnosticsLogger engine and types"
```

---

### Task 2: Call Termination Monitor & Automatic Export

**Files:**
- Create: `src/diagnostics/call-monitor.ts`
- Create: `tests/call-monitor.test.ts`

**Interfaces:**
- Consumes: `DiagnosticsLogger` from Task 1.
- Produces: `CallMonitor` class.
- Methods: `start(): void`, `stop(): void`, `triggerAutoExport(reason: string): Promise<void>`.

- [ ] **Step 1: Write unit test for CallMonitor detection logic**

Create `tests/call-monitor.test.ts` testing leave-button selector matching, meeting-ended screen detection heuristics, and debounced export triggering.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --experimental-strip-types tests/call-monitor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement CallMonitor**

Implement `src/diagnostics/call-monitor.ts` with:
- Listener on the Meet "Leave call" button (`button[aria-label*="Leave call" i]`, `button[aria-label*="Покинути" i]`, `button[aria-label*="Завершити" i]`).
- MutationObserver detecting exit screens (`"You left the meeting"`, `"Ви залишили зустріч"`).
- `window.addEventListener('beforeunload')` fallback.
- Auto-triggers file download via synthetic anchor or `chrome.runtime.sendMessage`.
- Displays a brief toast: *"MeetSwitcher: Лог уроку успішно збережено у Завантаження"*.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --experimental-strip-types tests/call-monitor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics/call-monitor.ts tests/call-monitor.test.ts
git commit -m "feat(diagnostics): add CallMonitor for automatic post-call export"
```

---

### Task 3: Instrumentation of ScreenDetector & PinController

**Files:**
- Modify: `src/content/detector.ts`
- Modify: `src/content/pin-controller.ts`
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `DiagnosticsLogger`, `CallMonitor`.
- Instruments: `detector.scan()`, `isPresentationTile()`, `pinController.switchToShare()`, `handlePinMenuIfOpened()`, `unpinActiveStreams()`.

- [ ] **Step 1: Instrument ScreenDetector**

In `src/content/detector.ts`:
- Log scan start, count of `<video>` tags found.
- Log every tile evaluation: why it was accepted as presentation or rejected as webcam (aria-labels, icons, text).
- Log active pin state and registry updates.

- [ ] **Step 2: Instrument PinController**

In `src/content/pin-controller.ts`:
- Log hotkey / switch requests: target name, index, whether target was in active DOM or off-screen.
- Log grid expansion unpin actions.
- Log host menu detection, listed items, and selected option ("Лише для мене" vs "Для всіх").
- Capture DOM snapshot on any missing pin button or failed switch.

- [ ] **Step 3: Wire DiagnosticsLogger and CallMonitor in index.ts**

Initialize `DiagnosticsLogger` and `CallMonitor` in `src/content/index.ts`. Expose debug hook `window.__MEET_SWITCHER_LOGS__`.

- [ ] **Step 4: Verify typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/content/
git commit -m "feat(diagnostics): instrument detector and pin controller with detailed logging"
```

---

### Task 4: Chrome Toolbar Popup for Post-Call Log Access

**Files:**
- Create: `src/popup/popup.html`
- Create: `src/popup/popup.ts`
- Create: `src/popup/popup.css`
- Modify: `manifest.json`
- Modify: `scripts/build.js`

**Interfaces:**
- Reads: `chrome.storage.local` session logs.
- Produces: Visual popup with session details, download button, copy button, and past session selector.

- [ ] **Step 1: Create popup UI and script**

Build clean dark-themed `popup.html`, `popup.css`, and `popup.ts` displaying:
- Current/Last session date, duration, participant count, switch count, error count.
- **«⬇ Завантажити лог (.json)»** button.
- **«📋 Скопіювати лог»** button.
- List of previous sessions.

- [ ] **Step 2: Update manifest.json**

Add `"downloads"` to permissions and configure `"action": { "default_popup": "popup.html" }`.

- [ ] **Step 3: Update scripts/build.js**

Add build step in `scripts/build.js` to compile `src/popup/popup.ts` and copy `popup.html` / `popup.css` to `dist/`.

- [ ] **Step 4: Build and verify output**

Run: `npm run build`
Verify `dist/popup.html`, `dist/popup.js`, `dist/popup.css` are generated.

- [ ] **Step 5: Commit**

```bash
git add src/popup/ manifest.json scripts/build.js
git commit -m "feat(popup): add toolbar popup for post-call diagnostic log download"
```

---

### Task 5: End-to-End Verification & Documentation

**Files:**
- Modify: `package.json`
- Test: All tests

- [ ] **Step 1: Run complete test suite**

Run: `npm test`
Expected: All test suites pass.

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Build extension**

Run: `npm run build`
Expected: Clean build in `dist/`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: complete automated call diagnostics and export implementation"
```
