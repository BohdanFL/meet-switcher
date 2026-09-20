## 1. Setup UI Classes

- [x] 1.1 Create `src/content/ui/dom-utils.ts`, move `dispatchFullClick` and `hoverTile` from `pin-controller.ts` into it as exported functions, and verify TypeScript compiles.
- [x] 1.2 Create `src/content/ui/side-panel-ui.ts` with a `MeetSidePanelUI` class. Move `isOpen`, `open`, `findPresentationItemInPeoplePanel`, `findPinButtonInItem`, and `pinParticipant` logic here. Verify TypeScript compiles.
- [x] 1.3 Create `src/content/ui/grid-ui.ts` with a `MeetGridUI` class. Move `ensureTileVisible`, `handlePinMenuIfOpened`, and the grid pinning/unpinning operations (`pinTile`, `unpinAll`) here. Verify TypeScript compiles.

## 2. Refactor Orchestrator

- [x] 2.1 Refactor `src/content/pin-controller.ts` to remove the duplicated/moved methods. Instantiate `MeetGridUI` and `MeetSidePanelUI` in the constructor. Update `switchToShare` and `unpin` to use these classes instead of direct DOM operations.
- [x] 2.2 Verify logic paths for `switchToShare` are preserved: check if target is pinned -> check if target in DOM -> if not, try side panel -> if side panel fails, unpin all, scan, and try grid -> if in grid, ensure visible, hover, find pin, dispatch click, handle menu.

## 3. Testing and Verification

- [x] 3.1 Update `tests/pin-controller.test.ts` to handle the new class structures (mocking grid/panel or continuing to use DOM mocks if the UI classes use the passed-in document). Ensure all 90 tests pass (`npm run test`).
