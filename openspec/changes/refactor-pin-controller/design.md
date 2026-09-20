## Context

`src/content/pin-controller.ts` is a monolithic class mixing state orchestration with direct DOM manipulation, simulated clicking, and Google Meet specific parsing (like traversing the host pin menu). See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**
- Separate DOM interaction (hovering, finding elements, dispatching synthetic clicks) from coordination.
- Provide Promise-based, robust methods for the controller to use, which encapsulate their own polling/retry logic.
- Simplify `pin-controller.ts` so it reads like a state machine or orchestrator.

**Non-Goals:**
- We are not changing the core switching logic, timeout lengths, or how `detector.ts` determines participants.
- We are not modifying the DOM tree manually, only reading and interacting with it.

## Decisions

### 1. Extract UI interaction classes (`MeetGridUI`, `MeetSidePanelUI`)
**Decision**: Create dedicated UI controller classes that handle all DOM parsing and interaction.
**Rationale**: `pin-controller.ts` currently knows too much about exactly what an unpin button looks like and how long to wait for a tile to render. Moving this to `MeetGridUI` encapsulates those rules.
**Alternatives**: We could have used simple utility functions, but class-based encapsulation allows us to inject the `logger` and share context more easily.

### 2. Encapsulate Retry/Polling Logic inside UI Classes
**Decision**: The methods (e.g. `grid.pinTile(tile)`) will return Promises and handle their own retries (e.g., polling for the button to appear after hovering).
**Rationale**: Keeps the orchestrator clean. The orchestrator just says "pin this tile" and awaits the result.
**Alternatives**: Leave polling in the orchestrator, making the UI classes purely static selectors. This was rejected because the orchestrator would still be cluttered with `for(let i=0; i<6; i++) { sleep(40); ... }` loops.

### 3. Extract `DomUtils`
**Decision**: Create `src/content/ui/dom-utils.ts` to host `dispatchFullClick` and `hoverTile`.
**Rationale**: These are purely synthetic event dispatchers and are needed by both the Grid and Side Panel UI classes.

## Risks / Trade-offs

- **Risk**: Creating new files and classes means `PinController` will need to have these classes injected or instantiated. -> **Mitigation**: We will instantiate them inside `PinController`'s constructor and pass down dependencies like `logger` and `detector`.
- **Risk**: Moving the polling logic might change exact timing sequences if we aren't careful. -> **Mitigation**: We will copy the exact polling counts and sleep intervals from the original code into the new UI classes.
