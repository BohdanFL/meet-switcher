## Why

During online group classes conducted via Google Meet, up to 9 students concurrently share their screens. The teacher must rapidly inspect each student's progress. Navigating Meet's default interface requires manual hunting through tiles, finding menu options, and repeatedly pinning/unpinning, which wastes instructional time and increases cognitive fatigue.

## What Changes

* Introduce a lightweight Chrome Extension (Manifest V3) named MeetSwitcher.
* Add dynamic DOM detection to distinguish screen shares from webcams.
* Inject an isolated Floating HUD (Shadow DOM) displaying detected student screens with active indicator.
* Implement 1-click switching logic: automatically unpins current pinned stream and pins target student's stream.
* Add hotkeys: `Alt + 1..9` for direct switching and `Alt + ArrowLeft / ArrowRight` (and `Alt + J / K`) for cyclic switching.

## Capabilities

### New Capabilities
- `screen-switching`: Automates detection of student screen shares, provides 1-click Pin/Unpin switching, floating HUD overlay, and keyboard navigation.

### Modified Capabilities
<!-- None -->

## Impact

* Affected environment: Google Meet web application (`https://meet.google.com/*`).
* Technologies: TypeScript, Vite, WebExtensions Manifest V3, Shadow DOM.
* Dependencies: `@types/chrome`, `@crxjs/vite-plugin` (or Vite build script).
