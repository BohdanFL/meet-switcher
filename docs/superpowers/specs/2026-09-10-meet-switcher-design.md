# OpenSpec: MeetSwitcher Chrome Extension

## 1. Metadata & Overview
* **Project Name**: MeetSwitcher (MeetFocus / ClassDeck)
* **Target Environment**: Google Chrome (Manifest V3, Content Script, Shadow DOM)
* **Technology Stack**: TypeScript, Vite, WebExtensions API
* **Document Version**: 1.0.0
* **Date**: 2026-09-10
* **Status**: Approved for Implementation

---

## 2. Context & Problem Statement
During online group classes conducted via Google Meet, up to 9 students concurrently share their screens. The teacher must rapidly inspect each student's progress.

Currently in Google Meet:
1. The teacher must open the participant list or hunt for small tiles.
2. Participant tiles are duplicated (webcam vs. screen share stream).
3. Pinning requires multiple clicks (hovering tile, finding pin icon, clicking).
4. Before switching to another student, the teacher often has to manually unpin the previous student.
5. This process takes 5-15 seconds per switch and introduces high cognitive friction.

### Objective
Create a lightweight, resilient Chrome Extension (Manifest V3) that adds a floating HUD and keyboard shortcuts (`Alt+1`..`9`, `Alt+Left/Right`) to switch between student presentations with a single click or keystroke, automatically unpinning the active tile and pinning the target student's stream.

---

## 3. Goals & Non-Goals

### Goals
* **G-1 (Automatic Detection)**: Continuously detect all active presentation streams in Google Meet using multi-attribute heuristics.
* **G-2 (Webcam Exclusion)**: Distinguish screen shares from webcams with 100% accuracy based on Meet's DOM signatures (e.g. `keep_outline`, `keep_off`, presentation labels, SVG icons).
* **G-3 (1-Click Pin/Unpin)**: Programmatically unpin current pinned stream and pin the selected student's stream seamlessly.
* **G-4 (Floating Draggable HUD)**: Provide a clean, dark-themed draggable HUD inside an isolated Shadow DOM overlay that does not clash with Meet CSS.
* **G-5 (Keyboard Navigation)**: Support `Alt + 1` through `Alt + 9` for direct switching, and `Alt + ArrowLeft / ArrowRight` (plus `Alt + J / K`) for cyclic switching.
* **G-6 (Multi-language & Resilience)**: Support English, Ukrainian, and generic icon/attribute selectors so UI changes or language switches do not break the extension.

### Non-Goals
* Managing student audio or video permissions.
* Recording or capturing screen streams.
* Modifying Google Meet backend or WebRTC streams directly.

---

## 4. Architecture & Module Design

```text
meet-switcher/
├── manifest.json              # Chrome MV3 manifest
├── package.json               # Dependencies & build scripts
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts             # Vite bundler configuration
├── src/
│   ├── types/
│   │   └── index.ts           # Shared data models and interfaces
│   ├── content/
│   │   ├── index.ts           # Entry point injected into https://meet.google.com/*
│   │   ├── detector.ts        # DOM scanner, MutationObserver, heuristics
│   │   ├── pin-controller.ts  # Pin / Unpin execution engine
│   │   ├── hotkeys.ts         # Keyboard event listeners (Alt+1..9, cyclic)
│   │   └── ui/
│   │       ├── hud.ts         # Shadow DOM host & HUD component renderer
│   │       ├── drag-drop.ts   # Draggable positioning & localStorage persistence
│   │       └── styles.css     # Scoped CSS styles for HUD
│   └── background/
│       └── service-worker.ts  # Background worker for extension lifecycle
└── dist/                      # Production build output
```

### Data Flow Diagram
```
  ┌──────────────────────────────────────────────────────────┐
  │                   Google Meet DOM Tree                   │
  └─────────────┬──────────────────────────────▲─────────────┘
                │ MutationObserver             │ Simulate Click
                ▼                              │ (Pin / Unpin)
  ┌───────────────────────────┐  Pin Command   │
  │   detector.ts (Scanner)   │───────────┐    │
  └─────────────┬─────────────┘           │    │
                │ ScreenShare[]           ▼    │
                ▼               ┌──────────────────────────┐
  ┌───────────────────────────┐ │    pin-controller.ts     │
  │     hud.ts (Shadow DOM)   │ └──────────────▲───────────┘
  └───────────────────────────┘                │ Key Event
                ▲                              │
                └─────────── hotkeys.ts ───────┘
```

---

## 5. Domain Models & Contracts (`src/types/index.ts`)

```typescript
export interface ScreenShare {
  /** Unique identifier derived from data-participant-id or index */
  id: string;
  /** Display name of the participant (e.g., "Andrii Chernysh", "You") */
  participantName: string;
  /** Assigned 1-based index for hotkey mapping (1..9) */
  index: number;
  /** Whether this screen share is currently pinned to the main stage */
  isPinned: boolean;
  /** DOM element reference of the video tile container */
  tileElement: HTMLElement;
  /** The Pin button element if found on the tile */
  pinButton?: HTMLButtonElement | null;
  /** The Unpin button element if currently pinned */
  unpinButton?: HTMLButtonElement | null;
}

export interface SwitchOptions {
  /** Target screen share id or index */
  targetIndex: number;
}
```

---

## 6. DOM Detection & Heuristics Engine (`src/content/detector.ts`)

Based on live DOM analysis of Google Meet:

### 1. Tile Identification
* **Selector**: `div[data-participant-id], div[data-requested-participant-id], div[data-tile-media-id], div.oZRSLe`
* **Video Container**: Contains a `<video>` element with active media stream.

### 2. Presentation vs. Webcam Classification
A tile is classified as a **Screen Share (Presentation)** if ANY of the following match:
1. Contains a button whose `aria-label` matches:
   `/presentation/i` OR `/презентац/i`
2. Contains text or material icon name:
   `keep_outline` (Pin icon) OR `keep_off` (Unpin icon)
3. Tile's unpin button matches:
   `/unpin.*presentation/i` OR `/відкріпити.*презентац/i`
4. Contains SVG with screen share path or attribute `data-tile-type="presentation"`.

Tiles with only person webcams (e.g., matching `visual_effects`, `frame_person`, without presentation keywords or pin icons) are ignored.

### 3. Participant Name Extraction
* Heuristic 1: Extract from `"More options for (.*?)"` or `"Більше параметрів для (.*?)"` button.
* Heuristic 2: Extract from `"Unpin (.*?)'s presentation"` or `"Pin (.*?)'s presentation"`.
* Heuristic 3: If label is `"Pin your presentation"`, name is `"Ваш екран / You"`.
* Fallback: Parse non-icon text nodes within the tile header.

### 4. Detection Lifecycle
* Uses `MutationObserver` on `document.body` observing `childList` and `attributes` (`attributeFilter: ['data-participant-id', 'aria-label']`).
* Debounced at 150ms to prevent excessive processing during tile layout recalculations.

---

## 7. Pin / Unpin Switching Algorithm (`src/content/pin-controller.ts`)

When switching to student `targetIndex`:

```text
Step 1: Check currently pinned presentation.
        If a tile has an Unpin button (`keep_off` or `aria-label*="Unpin"` / `aria-label*="Відкріпити"`):
        -> Click the Unpin button.

Step 2: Wait 60ms for Meet animation frame and DOM update.

Step 3: Locate target student's tile (`ScreenShare` matching `targetIndex`).
        If pin button is not immediately rendered:
        -> Trigger `dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))` on target tile.

Step 4: Locate Pin button inside target tile (`aria-label*="Pin"` / `aria-label*="Закріпити"` or `keep_outline`):
        -> Click the Pin button.

Step 5: Notify HUD to update active badge and styling.
```

---

## 8. User Interface (Floating HUD) (`src/content/ui/`)

### 1. Mounting via Shadow DOM
* Element `<meet-switcher-host>` injected into `document.body`.
* `host.attachShadow({ mode: 'open' })` mounts styles and HTML.
* Guarantees 0% style bleeding from Meet or into Meet.

### 2. HUD Layout & Controls
* **Header**:
  * Drag handle icon `⠿`
  * Title: `MeetSwitcher`
  * Active screen counter: `[N/9]`
  * Minimize button: `─`
* **Body (Collapsible)**:
  * List of student presentation items:
    * Number badge: `[1]`, `[2]`, ...
    * Student name: e.g. `Andrii Chernysh`
    * Status icon: 📌 (Pinned) or 🖥️ (Available)
  * Click on item triggers immediate switch.
* **Footer / Quick Info**:
  * Shortcut hint: `Alt + 1..9 | Alt + ← →`

### 3. Drag-and-Drop & Persistence
* Custom drag handling with boundaries constrained to the browser viewport.
* Stores `{ x, y, collapsed }` in `localStorage['meetswitcher_hud_pos']`.
* Restores position automatically on page refresh.

---

## 9. Keyboard Shortcuts Engine (`src/content/hotkeys.ts`)

Attached to `window.addEventListener('keydown', handleKeydown, true)`:
* **`Alt + 1` through `Alt + 9`**: Direct switch to screen share index 1 through 9.
* **`Alt + ArrowRight` or `Alt + J`**: Cycle to next student screen share.
* **`Alt + ArrowLeft` or `Alt + K`**: Cycle to previous student screen share.
* Ignores events when user is currently typing in an `<input>`, `<textarea>`, or `[contenteditable="true"]` (such as the Google Meet in-call chat box).

---

## 10. Edge Cases & Error Handling

1. **Student stops sharing**: `MutationObserver` detects removal, refreshes list, updates index numbering, and cleans up HUD.
2. **Student joins while call is active**: Dynamically appended to list with next available index.
3. **Tile off-screen (Google Meet adaptive grid)**:
   * Meet renders loaded tiles in the grid. If a tile is clipped, simulated event triggers Meet re-focus.
   * If not found, attempts to read from the People panel.
4. **Active in-call chat input**: Hotkeys are strictly disabled while typing messages to avoid interfering with user text input.

---

## 11. Acceptance Criteria & Test Plan

| ID | Scenario | Expected Result |
|---|---|---|
| AC-1 | Meeting with 0 presentations | HUD shows "Очікування презентацій..." and 0 items. |
| AC-2 | Student starts presenting | HUD instantly detects new stream, displays `[1] Student Name`. |
| AC-3 | Click student button in HUD | Active pinned stream unpins; clicked student stream pins to center. |
| AC-4 | Press `Alt + 1`..`9` | Automatically pins corresponding student. |
| AC-5 | Press `Alt + ArrowRight` | Cycles to next student in sequence. |
| AC-6 | Drag HUD around screen | HUD smoothly moves and persists position after reload. |
| AC-7 | Chat typing | Typing in Meet chat does not trigger switching hotkeys. |
