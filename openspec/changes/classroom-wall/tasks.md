## 1. UI Overlay & Styling for Classroom Wall

- [x] 1.1 Add Classroom Wall CSS grid styles, card headers, animations, and modal styles to src/content/ui/styles.css
- [x] 1.2 Implement src/content/ui/wall.ts component with live video mirroring via srcObject and memory cleanup

## 2. Integration with HUD & Hotkeys

- [x] 2.1 Add Classroom Wall toggle button and state synchronization to src/content/ui/hud.ts
- [x] 2.2 Wire Alt+W and Escape keyboard shortcuts into src/content/hotkeys.ts
- [x] 2.3 Wire 1-click drill-down focus from Classroom Wall into PinController in src/content/index.ts
- [x] 2.4 Implement src/content/mock-generator.ts with 9 synthetic live student streams, Alt+Shift+D shortcut, and Demo HUD button

## 3. Build & Verification

- [x] 3.1 Run TypeScript typecheck and verify zero compile errors
- [x] 3.2 Run Vite build and verify updated dist/ artifacts
