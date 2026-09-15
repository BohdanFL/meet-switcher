# Design Spec: Student Nicknames & Aliases for Google Meet Accounts

* **Feature Name**: Student Nicknames & Account Aliases (Teacher Reminder Labels)
* **Target Environment**: Google Chrome (Manifest V3)
* **Date**: 2026-09-15
* **Status**: Approved for Implementation

---

## 1. Problem Statement & Motivation
During online lessons, young students frequently join Google Meet using their parents' Google accounts (e.g. account displays *"Оксана Петренко"*, but the actual student in class is *"Максим"*).
For teachers, especially during the first weeks of classes, this creates significant cognitive strain trying to recall which parent account corresponds to which child.
The teacher needs a persistent, effortless mechanism to assign a real student name to an account **once**, so that on every subsequent call, the extension automatically displays the student's name alongside the parent's account name across the entire interface (HUD, Classroom Wall, and on Google Meet video tiles).

---

## 2. Requirements & Goals

### Functional Goals
1. **Persistent Account-to-Student Mapping**:
   - Store mapping of `Original Account Name -> Student Nickname` in `chrome.storage.sync` (with automatic fallback to `chrome.storage.local`).
   - Retain mappings permanently across calls, sessions, and devices (synced with teacher's Google account).
2. **Combined Display Format**:
   - Always display in combined format: `"${studentName} (${originalAccountName})"` (e.g., `"Максим (Оксана Петренко)"`).
   - If no alias has been set for an account, display the original account name as usual.
3. **1-Click Inline Editing**:
   - In **HUD** and **Classroom Wall**: An edit icon (✏️) next to participant names allows editing the student name directly in-place without leaving or interrupting the call.
   - Saves immediately on `Enter` or checkmark click. Cancels on `Escape`.
   - Clearing the name removes the alias and reverts to the original account name.
4. **Google Meet Tile Badge Overlay**:
   - An unobtrusive floating badge (`.meet-switcher-student-badge`) injected on the presentation/participant tile in Google Meet.
   - Styled as a clean, rounded, semi-transparent label in the top corner of the tile displaying `🏷️ Максим (Оксана Петренко)`.
   - Modifies no internal Google Meet DOM text nodes directly, preventing React/Wiz virtual DOM reconciliation errors or text flickers.
5. **Roster Management in Extension Popup**:
   - A dedicated "Учні та псевдоніми" (Student Aliases) section in `popup.html`.
   - Lists all saved mappings with search/filtering, editing, and deletion.
   - JSON Export and Import buttons for backup and transferring rosters.

### Non-Goals
* No external backend or cloud database required (local-first via Chrome storage).
* No modification of Google Meet's core DOM text nodes that could destabilize Meet.
* No conflict with other active features or parallel development streams.

---

## 3. Architecture & File Structure

```text
src/
├── content/
│   ├── alias-manager.ts     # Core service: storage sync, caching, normalization, formatting
│   ├── ui/
│   │   ├── hud.ts           # Updated to display aliases & inline editing (✏️)
│   │   ├── wall.ts          # Updated to display aliases & inline editing in Classroom Wall
│   │   └── tile-badge.ts    # Decorator for Google Meet video tiles (floating badge)
│   ├── detector.ts          # Keeps original detection clean; triggers tile badge updates
│   └── index.ts             # Instantiates AliasManager and wires updates
├── popup/
│   ├── popup.html           # Added "Учні (Псевдоніми)" tab/section
│   ├── popup.ts             # Roster rendering, search, inline editing, JSON export/import
│   └── popup.css            # Styling for roster list, inputs, badges
├── types/
│   └── index.ts             # StudentAlias and StudentAliasMap interfaces
```

---

## 4. Data Model & Storage

```typescript
export interface StudentAliasEntry {
  /** Normalized lowercase lookup key (e.g., "оксана петренко") */
  key: string;

  /** Original Google Meet display name as detected (e.g., "Оксана Петренко") */
  originalName: string;

  /** Custom student nickname/real name assigned by teacher (e.g., "Максим") */
  alias: string;

  /** Timestamp of when the alias was created or last updated */
  updatedAt: number;
}

export type StudentAliasMap = Record<string, StudentAliasEntry>;
```

### Storage Mechanism
* Storage Key: `'meet_switcher_student_aliases'`
* Storage Engine: `chrome.storage.sync` with automatic catch/fallback to `chrome.storage.local` if sync quota is exceeded or offline.
* In-Memory Cache: `AliasManager` maintains a memory Map for synchronous, high-performance lookups during rapid DOM scans.
* Reactive Sync: Listens to `chrome.storage.onChanged` to immediately reflect edits made across any open tab or popup window.

---

## 5. UI & Interaction Flows

### A. Inline Editing in HUD & Classroom Wall
1. Each item displays:
   - Index badge (e.g. `[1]`)
   - Name: `Максим (Оксана Петренко)` with a subtle `🏷️` tag if an alias is active.
   - Edit button (`✏️`) visible on hover or focus.
2. Clicking `✏️`:
   - Replaces name text with an inline `<input type="text">` populated with the current alias.
   - `stopPropagation()` prevents triggering screen switching or tile pinning.
   - Keys: `Enter` saves, `Escape` cancels.
   - Clicking outside (blur) or clicking the save button `✓` triggers `AliasManager.setAlias(originalName, newAlias)`.
   - On save, HUD and Wall immediately re-render with the new combined name.

### B. Google Meet Video Tile Badge (`TileBadgeDecorator`)
1. When `detector.ts` scans presentation tiles or video containers:
   - Checks if the tile's participant has a configured alias.
   - If an alias exists:
     - Injects or updates an overlay element: `<div class="meet-switcher-student-badge">🏷️ Максим (Оксана Петренко)</div>`.
     - Placed inside `tileElement` with `position: absolute; top: 12px; left: 12px; z-index: 10; pointer-events: none;`.
     - Styling: `background: rgba(20, 20, 20, 0.82); backdrop-filter: blur(4px); color: #fff; border-radius: 6px; padding: 4px 10px; font-size: 13px; font-weight: 500; box-shadow: 0 2px 6px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15);`.
   - If no alias exists:
     - Removes any existing custom badge from the tile.

### C. Extension Popup Roster Tab
1. Navigation or collapsible section in `popup.html`: **"👥 Учні та псевдоніми"**.
2. Features:
   - Search filter bar (filter by parent or student name).
   - Scrollable list of all saved pairs: `[Оксана Петренко] ➔ [Максим] [✏️] [🗑️]`.
   - Quick Add form at top: Original Name input + Student Name input + Add button.
   - **"⬇ Експорт (JSON)"**: downloads `meet-students-backup-YYYY-MM-DD.json`.
   - **"⬆ Імпорт (JSON)"**: file picker to restore or merge existing student lists.

---

## 6. Edge Cases & Reliability

1. **Meet Tile DOM Recreation**:
   - Google Meet often destroys and recreates tile containers when participants pin/unpin or switch view modes.
   - `TileBadgeDecorator` is invoked on each `detector.scan()` cycle, ensuring the badge is re-attached immediately without flickering.
2. **Name Variations & Trimming**:
   - Normalization function trims leading/trailing spaces, removes redundant whitespace, and strips Meet presentation suffixes (`(презентація)`, `'s presentation`) before looking up in the alias table.
3. **Safety & Zero Conflicts with Parallel Agent**:
   - The `AliasManager` and `TileBadgeDecorator` are completely decoupled standalone modules.
   - Integrations into `hud.ts` and `wall.ts` are lightweight format calls `aliasManager.formatDisplayName(share.participantName)`.

---

## 7. Testing & Verification

1. **Unit Tests (`tests/alias-manager.test.ts`)**:
   - Alias storage, retrieval, case-insensitive normalization.
   - Combined formatting string: `"${alias} (${orig})"`.
   - Reverting to original when alias is deleted or empty.
2. **Interactive Simulation (Demo Mode)**:
   - Using built-in MockGenerator (`Alt + Shift + D`):
   - Rename mock students (e.g., assign "Максим" to "Alex", "Софія" to "Maria").
   - Verify immediate update across HUD, Wall, and simulated video tiles.
   - Verify persistence after page reload.
3. **Popup Verification**:
   - Verify that renamed mock students appear in popup roster.
   - Verify JSON export produces valid structured JSON.
