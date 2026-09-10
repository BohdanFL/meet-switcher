## Context

See proposal.md for motivation. The extension injects into `https://meet.google.com/*` pages and interacts with Google Meet's DOM. From live analysis of Meet's DOM, tiles use `data-participant-id`, `class="oZRSLe"`, and differentiate presentations via `keep_outline` (Pin), `keep_off` (Unpin), and aria labels matching `presentation` / `презентація`.

## Goals / Non-Goals

**Goals:**
* Modular TypeScript codebase bundled with Vite into Chrome Manifest V3 format.
* Zero CSS collision with Google Meet using Shadow DOM for the HUD overlay.
* Resilient DOM detection engine combining `MutationObserver`, icon indicators, and multi-language aria labels.
* Programmatic 1-click Pin/Unpin state synchronization.
* Keyboard hotkeys (`Alt+1..9`, `Alt+Left/Right`, `Alt+J/K`) with chat-input suppression.

**Non-Goals:**
* Modifying WebRTC video stream buffers.
* Recording or modifying participant streams.

## Decisions

### Decision 1: Vite + TypeScript Bundler
* **Choice**: Vite with a multi-input build script outputting to `dist/`.
* **Rationale**: Fast compilation, strict type safety, modern ES modules, clean production output.
* **Alternatives Considered**: Vanilla JS without bundler (lacks type safety across modules), Webpack (heavier setup).

### Decision 2: Shadow DOM for HUD
* **Choice**: Mount `<meet-switcher-host>` in `document.body` and attach Shadow Root (`mode: 'open'`).
* **Rationale**: Google Meet injects extensive global CSS rules that could break extension UI, or extension CSS could corrupt Meet styles. Shadow DOM provides 100% encapsulation.
* **Alternatives Considered**: Direct `div` injection (fragile to CSS specificity conflicts).

### Decision 3: Event-Driven DOM Scanner with MutationObserver
* **Choice**: Observe `childList` and `attributeFilter: ['data-participant-id', 'aria-label']` debounced at 150ms.
* **Rationale**: Eliminates polling CPU overhead and immediately detects student stream changes.
* **Alternatives Considered**: `setInterval` polling (wastes battery and CPU).

### Decision 4: Multi-Attribute Heuristics for Screen Share Detection
* **Choice**: Inspect tile buttons for `/presentation/i`, `/презентац/i`, `keep_outline`, `keep_off`, and `"More options for "`.
* **Rationale**: Google Meet constantly changes internal class names, but accessibility labels and Material Icon names remain stable.

## Risks / Trade-offs

* **[Risk] Google Meet UI changes**: Selector breakage if Google redesigns tile DOM.
  → **Mitigation**: Multi-tier heuristics (SVG icon paths, Material icon text, aria-labels, and parent containers).
* **[Risk] Hotkey conflicts**: Clashing with OS or browser shortcuts.
  → **Mitigation**: Use `Alt + Number` and verify events don't trigger when typing in `input`/`textarea`.
