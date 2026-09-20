# selectors Specification

## Purpose
Provides a centralized, robust, and language-agnostic mechanism for locating and identifying Google Meet UI elements like Pin/Unpin buttons and side panels.

## Requirements

### Requirement: Language-agnostic UI element selection
The system SHALL prioritize locating interactive UI elements (such as the Pin or Unpin buttons) using visually distinct, stable structural attributes such as Material Icons (e.g. `keep_outline`, `keep_off`) before falling back to localized text or ARIA labels.

#### Scenario: Pin button located via icon
- **WHEN** the system queries for a Pin button in a participant tile
- **THEN** it first attempts to find an element containing the `keep_outline` icon and returns its corresponding clickable target

#### Scenario: Unpin button located via icon
- **WHEN** the system queries for an Unpin button in a participant tile
- **THEN** it first attempts to find an element containing the `keep_off` icon and returns its corresponding clickable target

### Requirement: Centralized localized fallback dictionary
The system SHALL maintain a centralized dictionary of regular expressions to match UI elements by their `aria-label`, `data-tooltip`, or text content when icon-based selection fails or is unavailable. This dictionary MUST support multiple languages simultaneously (e.g. English, Ukrainian, Russian).

#### Scenario: Element located via localized fallback
- **WHEN** a structural or icon-based selection fails to locate a button
- **THEN** the system uses the centralized multi-language dictionary to find the element by evaluating its accessibility labels against the known regex patterns
