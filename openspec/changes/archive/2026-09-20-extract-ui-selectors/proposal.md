## Why

Currently, localization and language bindings (English, Ukrainian, Russian) for Google Meet DOM elements are scattered across `detector.ts`, `pin-controller.ts`, and `side-panel-decorator.ts`. This causes maintenance friction, bugs with different Google Meet language settings, and issues with locating buttons (e.g. Pin, Unpin) or the teacher's own presentation when labels change. A centralized hybrid module mapping icons and regex string fallbacks is needed to clean up the architecture and make it more robust against UI changes.

## What Changes

- Create a new centralized dictionary for supported Meet interface strings and icons (`dictionary.ts`).
- Create a new UI selectors facade (`selectors.ts`) providing pure functions for locating Google Meet DOM elements (Pin button, Unpin button, People Panel, Teacher Presentation).
- Refactor `detector.ts`, `pin-controller.ts`, and `side-panel-decorator.ts` to depend strictly on the UI selectors facade rather than hardcoded DOM strings.

## Capabilities

### New Capabilities
- `content-ui/selectors`: Centralized facade for locating Google Meet UI elements in a language-agnostic way (using Material icons) with regex-based fallbacks for multiple languages.

### Modified Capabilities
- (None existing)

## Impact

- `src/content/detector.ts`
- `src/content/pin-controller.ts`
- `src/content/ui/side-panel-decorator.ts`
- Minimal impact on extension behavior, but significant improvement in internal stability across non-English language profiles.
