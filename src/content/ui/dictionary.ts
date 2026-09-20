/**
 * Centralized dictionary for Google Meet UI element strings, labels, and icons.
 * This ensures language-agnostic DOM lookups and provides fallbacks for supported languages
 * (English, Ukrainian, Russian).
 */
export const MEET_DICTIONARY = {
  // Common action words found in aria-labels, tooltips, or inner text
  ACTIONS: {
    PIN: /(?:pin|закріп|прикріп|keep)/i,
    UNPIN: /(?:unpin|відкріп|откреп)/i,
  },

  // Words that identify the side panels
  PANELS: {
    PEOPLE: /(?:people|учасник|люди|показати всіх|show everyone)/i,
    IN_CALL: /(?:in call|дзвінк|вызов)/i,
    SIDE_PANEL: /(?:side panel)/i,
  },

  // Presentation identifiers
  PRESENTATION: {
    // Note: Teacher presentation filters have been intentionally removed
    // to treat the local user's presentation as a standard participant tile.
    PRESENTATION_KEYWORD: /(?:presentation|презентац|present_to_all|трансляц)/i,
  },

  // Google Meet Host Pin Menu explicitly has "For myself only" vs "For everyone"
  HOST_PIN_MENU: {
    FOR_MYSELF_ONLY: /(?:myself|for me|лише для мене|для мене|себе|себя)/i,
    FOR_EVERYONE: /(?:everyone|all|для всіх|для всех)/i,
  },

  // "More actions" 3-dots button
  MORE_ACTIONS: /(?:more action|дії|більше|more_vert)/i,

  // Known Google Meet / Material icons often used in place of translated text
  ICONS: {
    PIN: 'keep', // keep or keep_outline
    PIN_OUTLINE: 'keep_outline',
    UNPIN: 'keep_off',
    MORE_VERT: 'more_vert',
    PEOPLE: 'people',
  },
};
