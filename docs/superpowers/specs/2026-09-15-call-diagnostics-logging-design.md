# Design Spec: Automatic Call Diagnostics, Timeline Logging & Post-Call Export

* **Feature Name**: Automatic Call Diagnostics & Post-Call Export
* **Target Environment**: Google Chrome (Manifest V3)
* **Date**: 2026-09-15
* **Status**: Approved for Implementation

---

## 1. Problem Statement & Motivation
During real lessons in Google Meet, subtle DOM changes, host popups, and layout reflows can cause unexpected behavior (such as webcam capture or tile reduction).
The teacher cannot and should not be distracted during the lesson by opening DevTools, copying logs, or clicking debug buttons.
Therefore, the extension must passively record an exhaustive, structured timeline of everything that happens behind the scenes, and **automatically save/download** the complete log file when the call ends, as well as keep a backup accessible at any time from the Chrome extension popup.

---

## 2. Requirements & Goals

### Functional Goals
1. **Zero Distraction (Passive Background Recording)**:
   - Record every DOM scan, detected tile, tile classification decision (presentation vs webcam with reasons, aria-labels, icons).
   - Record every pin/unpin action, hotkey trigger, host menu detection, and option selection.
   - Record full DOM snapshots on errors or unexpected states.
2. **Automatic Call End Export**:
   - Detect when the Google Meet call ends (clicking Leave Call / "Покинути дзвінок", appearance of the exit/rejoin screen, or tab unload).
   - Automatically trigger download of `meet-switcher-log-YYYY-MM-DD_HH-mm.json` to the user's Downloads folder.
   - Show a non-intrusive toast notification: *"MeetSwitcher: Лог уроку збережено у Завантаження"*.
3. **Persistent Rolling Session History**:
   - Maintain logs of the last 5 sessions in `chrome.storage.local`.
   - Prevent any memory leaks via a circular ring buffer (default 1000 events per session).
4. **Chrome Toolbar Popup**:
   - Clicking the extension icon in the Chrome toolbar shows a clean modal with:
     - Last session summary (date, duration, participant count, switch count, error count).
     - **"⬇ Завантажити лог останнього уроку (.json)"** button.
     - **"📋 Скопіювати лог"** button.
     - History of past sessions.

### Non-Goals
* No external remote webhook or cloud transmission (100% private, local-first).
* No media stream recording (only metadata, DOM attributes, and UI actions).

---

## 3. Architecture & File Structure

```text
src/
├── diagnostics/
│   ├── logger.ts          # DiagnosticsLogger singleton, ring buffer, DOM snapshots
│   ├── call-monitor.ts     # Detects call termination (Leave button, exit screen, unload)
│   └── types.ts           # LogEvent, SessionLog, DomSnapshot interfaces
├── popup/
│   ├── popup.html         # Toolbar popup UI
│   ├── popup.ts           # Popup event handlers, storage retrieval, JSON download
│   └── popup.css          # Dark-themed modern styling
├── content/
│   ├── detector.ts        # Instrumented with logger calls
│   ├── pin-controller.ts  # Instrumented with logger calls
│   └── index.ts           # Initializes DiagnosticsLogger and CallMonitor
└── background/
    └── service-worker.ts  # Handles background download requests if needed
```

---

## 4. Log Data Model

```typescript
export interface DomSnapshot {
  videoCount: number;
  tiles: Array<{
    id: string;
    tag: string;
    isPresentation: boolean;
    reason: string;
    ariaLabel?: string;
    buttons: Array<{ label?: string; tooltip?: string; text?: string; isPin?: boolean }>;
    textSnippet: string;
  }>;
  isPinnedActive: boolean;
}

export interface LogEvent {
  timestamp: string;
  elapsedMs: number;
  category: 'SCAN' | 'ACTION' | 'MENU' | 'DOM' | 'ERROR' | 'SYSTEM';
  message: string;
  details?: Record<string, any>;
  snapshot?: DomSnapshot;
}

export interface SessionLog {
  id: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
  meetUrl: string;
  totalSwitches: number;
  errorCount: number;
  detectedParticipants: string[];
  events: LogEvent[];
}
```

---

## 5. Acceptance Criteria
- [x] Every scan and switch logs detailed context without performance overhead.
- [x] When teacher clicks Leave Call or closes the meeting, `meet-switcher-log-*.json` is automatically downloaded.
- [x] Popup in Chrome toolbar displays last session and allows downloading/copying JSON at any time.
- [x] Storage maintains last 5 sessions without overflowing storage limits.
