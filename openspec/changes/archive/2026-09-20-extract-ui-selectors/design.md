## Context

See `proposal.md` for the motivation. Google Meet UI elements (like buttons and Side panels) are currently located via hardcoded English, Ukrainian, and Russian text patterns directly within logic files like `detector.ts` and `pin-controller.ts`. Google Meet uses obfuscated class names, requiring us to rely on stable structural aspects such as `aria-label`, inner text, and Material icons (`keep_outline`, `keep_off`). A hybrid architectural approach (Facade + Dictionary pattern) is needed to simplify the underlying business logic and provide a centralized place for future language additions or Google UI updates.

## Goals / Non-Goals

**Goals:**
- Decouple all text-based and icon-based DOM lookups from the business logic.
- Create a pure-function DOM abstraction layer (`selectors.ts`) providing standard access to Meet interactive elements.
- Create a configuration object mapping regular expressions to fallback patterns (`dictionary.ts`).

**Non-Goals:**
- Adding dynamic language detection (i.e. we will not detect `document.lang` and switch dictionaries; instead we will combine languages in regex as currently implemented but centralized).
- Modifying the underlying pinning logic or interaction flows; we are strictly refactoring how the elements are found.

## Decisions

**1. Dictionary + Facade Architecture**
- **Decision**: Introduce `src/content/ui/dictionary.ts` for Regex constants and `src/content/ui/selectors.ts` as a pure function library masking DOM access.
- **Rationale**: Keeps `detector.ts` and `pin-controller.ts` clean. Allows the Facade to optimize querying by trying CSS Selectors (`.keep_outline`) first before falling back to heavy text processing on DOM elements.
- **Alternative Considered**: Building a full i18n system detecting browser language. Rejected due to complexity and mismatch between account settings and browser lang in Google workspaces.

**2. Optimize for performance**
- **Decision**: `MeetSelectors` functions will attempt `querySelector('i:contains(...)')` or similar icon-based searches first before looping over `querySelectorAll('button')` and running regexes.
- **Rationale**: `detector.ts` runs on a fast `MutationObserver` debounce loop. Running multi-language regexes against every button on every DOM mutation is expensive.

## Risks / Trade-offs

- **Risk: Icon changes by Google** → Mitigation: Always provide a fallback to the localized text checks using the dictionary.
- **Risk: False Positives in Regex** → Mitigation: Use clear regex structures from the current implementation. Ensure that Unpin is evaluated prior to Pin if ambiguity exists.
- **Risk: Performance overhead of `Array.from(document.querySelectorAll)`** → Mitigation: Limit query scopes by passing context nodes (`tile: HTMLElement`) to the selector functions rather than querying the whole `document` wherever possible.
