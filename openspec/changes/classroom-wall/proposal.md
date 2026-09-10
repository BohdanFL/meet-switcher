## Why

While 1-click screen switching allows checking individual students, a teacher often needs a bird's-eye overview of up to 10 active student screens simultaneously to monitor class progress in real-time, detect who is struggling, and quickly jump into any student's screen.

## What Changes

* Introduce a dedicated "Classroom Wall" (Стіна класу) overlay mode.
* Render an optimized multi-screen live grid (e.g. 2x5 or 3x3 layout) mirroring active WebRTC screen share streams using zero-copy `srcObject` references.
* Display clear student badges with hotkey numbers `[1]..[10]` and participant names above each live thumbnail.
* Enable 1-Click Drill-Down: clicking any thumbnail closes the overview and automatically pins that student to the main center stage in Google Meet.
* Add shortcut `Alt + W` (and a button in the HUD) to toggle the Classroom Wall on and off.
* Ensure zero background overhead: pause/detach mirrored video streams when the wall is closed.

## Capabilities

### New Capabilities
- `classroom-wall`: Multi-screen live overview grid displaying up to 10 student screens with instant 1-click pin focus and toggle shortcuts.

### Modified Capabilities
<!-- None -->

## Impact

* Injected UI overlay in Shadow DOM inside Google Meet.
* Connects directly to existing `ScreenDetector` and `PinController`.
* No external network requests; zero re-encoding.
