## 1. UI Overlay & Styling for Classroom Wall

- [ ] 1.1 Add Classroom Wall CSS grid styles, card headers, animations, and modal styles to src/content/ui/styles.css
- [ ] 1.2 Implement src/content/ui/wall.ts component with live video mirroring via srcObject and memory cleanup

## 2. Integration with HUD & Hotkeys

- [ ] 2.1 Add Classroom Wall toggle button and state synchronization to src/content/ui/hud.ts
- [ ] 2.2 Wire Alt+W and Escape keyboard shortcuts into src/content/hotkeys.ts
- [ ] 2.3 Wire 1-click drill-down focus from Classroom Wall into PinController in src/content/index.ts
- [ ] 2.4 Implement src/content/mock-generator.ts with 9 synthetic live student streams, Alt+Shift+D shortcut, and Demo HUD button

## 3. Build & Verification

- [ ] 3.1 Run TypeScript typecheck and verify zero compile errors
- [ ] 3.2 Run Vite build and verify updated dist/ artifacts
