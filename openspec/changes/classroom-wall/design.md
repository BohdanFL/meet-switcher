## Context

See proposal.md for motivation. The extension already detects active screen shares with `ScreenDetector` and provides 1-click pinning via `PinController`. Teachers need a real-time overview grid of up to 10 active student screens simultaneously.

## Goals / Non-Goals

**Goals:**
* High-performance, zero-copy live video mirroring using native WebRTC `srcObject`.
* Responsive multi-screen CSS grid (up to 10 live screen shares) with student name headers and shortcut badges.
* 1-Click drill-down: clicking any live thumbnail immediately closes the wall and pins that student to the center stage in Google Meet.
* Keyboard hotkey `Alt + W` to toggle, and `Escape` to close.
* Zero CPU/GPU leak when the wall is closed.

**Non-Goals:**
* Modifying student streams or injecting custom video filters.
* Recording or saving student video feeds.

## Decisions

### Decision 1: Native HTML5 `srcObject` Stream Sharing
* **Choice**: Point each thumbnail's `<video>` tag directly to `originalVideo.srcObject`.
* **Rationale**: Chromium's media pipeline shares the underlying GPU texture between multiple `<video>` elements with zero additional network requests, zero re-encoding, and native hardware acceleration.
* **Alternatives Considered**: Canvas 2D capture (`drawImage`) at reduced FPS. Canvas polling is heavier on the CPU than native GPU-accelerated video playback.

### Decision 2: Mount Inside Existing Shadow DOM
* **Choice**: Render the Classroom Wall modal directly inside the existing `<meet-switcher-host>` Shadow DOM root.
* **Rationale**: Maintains complete style isolation from Google Meet, prevents Meet CSS from interfering, and reuses established HUD infrastructure.

### Decision 3: Responsive Dynamic Grid Layout
* **Choice**: CSS grid with dynamic column counts based on number of active screens:
  * 1-2 screens: 1-2 columns
  * 3-4 screens: 2x2 grid
  * 5-6 screens: 3x2 grid
  * 7-9 screens: 3x3 grid
  * 10 screens: 5x2 grid
* **Rationale**: Maximizes screen readability of code/documents on student screens at any class size.

### Decision 4: Lifecycle & Memory Optimization
* **Choice**: On closing, iterate through preview videos, call `.pause()`, and set `srcObject = null`.
* **Rationale**: Completely frees GPU render pipelines when the teacher is in single-screen focus mode.

## Risks / Trade-offs

* **[Risk] High GPU utilization if 10 1080p streams run concurrently**:
  → **Mitigation**: Videos are rendered at CSS thumbnail size with `muted = true`, and preview video pipeline is completely cleared when the overlay is closed.
* **[Risk] Key collision with browser / Meet shortcuts**:
  → **Mitigation**: `Alt + W` is safe on Chrome (unlike `Ctrl + W` which closes tabs), and events are suppressed when typing in chat.
