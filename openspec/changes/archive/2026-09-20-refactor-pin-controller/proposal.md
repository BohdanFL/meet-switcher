## Why

`src/content/pin-controller.ts` handles high-level orchestration (when to switch, when to fallback to the People Panel) but also contains low-level DOM polling, hovering, click simulation, and Google Meet specific menu traversing logic. It has grown into a 600-line monolithic controller that mixes concerns and is difficult to test or maintain.

## What Changes

- Extract low-level Google Meet interaction logic (e.g. `dispatchFullClick`, `hoverTile`) into shared UI utils.
- Extract Grid-specific operations (`ensureTileVisible`, `findPinButton`, handling the Host Pin Menu) into a dedicated `MeetGridUI` class.
- Extract Side Panel operations (`isOpen`, `open`, finding and pinning via the side panel) into a dedicated `MeetSidePanelUI` class.
- Simplify `PinController` to act purely as an orchestrator that calls high-level Promise-based methods on these new UI classes, hiding all polling/retry logic from the controller.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. This is a pure architectural refactoring. Spec-level behavior remains identical. `skip_specs: true` has been set for this change.

## Impact

- `src/content/pin-controller.ts` will shrink significantly.
- Introduces `src/content/ui/grid-ui.ts`, `src/content/ui/side-panel-ui.ts`, and `src/content/ui/dom-utils.ts`.
- Tests for `pin-controller.ts` will need to be updated to mock these new UI classes instead of a fake raw DOM.
