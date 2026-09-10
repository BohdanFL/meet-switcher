## 1. Project Infrastructure & Manifest Setup

- [x] 1.1 Initialize package.json, tsconfig.json, vite.config.ts, and manifest.json (Manifest V3) and verify package installation
- [x] 1.2 Define domain types in src/types/index.ts and verify TypeScript compilation

## 2. Core Detection & Switching Engines

- [x] 2.1 Implement src/content/detector.ts with MutationObserver and multi-attribute heuristics
- [x] 2.2 Implement src/content/pin-controller.ts with 1-click unpin and pin switching logic
- [x] 2.3 Implement src/content/hotkeys.ts with Alt+1..9 and cyclic switching with input suppression

## 3. UI Overlay (Shadow DOM & Floating HUD)

- [x] 3.1 Create src/content/ui/styles.css with dark-theme HUD styles
- [x] 3.2 Create src/content/ui/drag-drop.ts with viewport drag constraints and localStorage persistence
- [x] 3.3 Create src/content/ui/hud.ts with Shadow DOM mounting, list rendering, and state updates

## 4. Integration & Build Verification

- [x] 4.1 Create src/content/index.ts wiring detector, controller, hotkeys, and HUD together
- [x] 4.2 Add service worker, icons, run build script, and verify dist/ artifacts ready for Chrome
