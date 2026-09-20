## 1. Create Core UI Selection Modules

- [x] 1.1 Create `src/content/ui/dictionary.ts` and define the `MEET_DICTIONARY` object mapping constants and regex string matchers for icons, action words, and states (verify by ensuring the module compiles and exports the correct object).
- [x] 1.2 Create `src/content/ui/selectors.ts` and implement pure functions `findPinButton(tile: HTMLElement)`, `findUnpinButton(tile: HTMLElement)`, and `findPeoplePanelBtn(doc: Document)` utilizing the dictionary (verify by writing a mock test or manual check that ensures these functions return correct Elements given a mock DOM).

## 2. Refactoring Existing Business Logic

- [x] 2.1 Refactor `src/content/detector.ts` to replace all hardcoded text lookups (e.g., `button[aria-label*="unpin" i]`) with calls to methods from `src/content/ui/selectors.ts` and COMPLETELY REMOVE `isTeacherPresentationTile` and its usages so the teacher's presentation is treated as a normal screen share (verify that tests in `tests/roster-detector.test.ts` still pass after removing related tests).
- [x] 2.2 Refactor `src/content/pin-controller.ts` to replace hardcoded texts for People panel resolution and Host PIN menus with the centralized dictionary constants (verify that tests in `tests/pin-controller.test.ts` still pass).
- [x] 2.3 Refactor `src/content/ui/side-panel-decorator.ts` and `src/content/ui/wall.ts` to utilize the dictionary module where relevant (verify by running `npm test` and ensuring side-panel decorator unit tests pass).

## 3. Integration & Verification

- [x] 3.1 Run the full test suite (`npm run test` or equivalent) to guarantee that extracting the logic did not break any existing tests verifying core behavior (verify that 100% of the tests pass).
- [x] 3.2 Add or update tests in `tests/detector.test.ts` or create new tests for `selectors.ts` to ensure that icon-based lookups successfully return elements (verify new tests pass).
