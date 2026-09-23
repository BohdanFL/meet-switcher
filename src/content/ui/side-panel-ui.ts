import { DiagnosticsLogger } from '../../diagnostics/logger.ts';
import { ScreenDetector } from '../detector.ts';
import { MeetSelectors } from './selectors.ts';
import { MEET_DICTIONARY } from './dictionary.ts';
import { dispatchFullClick, hoverTile, sleep } from './dom-utils.ts';

export class MeetSidePanelUI {
  private logger: DiagnosticsLogger;
  private detector: ScreenDetector;
  
  constructor(logger: DiagnosticsLogger, detector: ScreenDetector) {
    this.logger = logger;
    this.detector = detector;
  }

  /**
   * Checks if Google Meet's People side panel is currently open in the DOM.
   */
  public isPeoplePanelOpen(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): boolean {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelector) return false;

    const peopleBtn = MeetSelectors.findPeoplePanelBtn(targetDoc);
    if (peopleBtn) {
      const isPressed = peopleBtn.getAttribute('aria-pressed') === 'true';
      const hasClass = Boolean(peopleBtn.classList?.contains && peopleBtn.classList.contains('qs41qe'));
      if (isPressed || hasClass) {
        return true;
      }
      return false;
    }

    const panel = MeetSelectors.findPeoplePanel(targetDoc);
    return Boolean(panel);
  }

  /**
   * Ensures Google Meet's People side panel is open.
   */
  public async open(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): Promise<boolean> {
    if (this.isPeoplePanelOpen(doc)) return true;
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc?.querySelector) return false;

    const peopleBtn = MeetSelectors.findPeoplePanelBtn(targetDoc);
    if (!peopleBtn) {
      this.logger.log('WARN', 'Could not locate People button to open side panel');
      return false;
    }

    this.logger.log('ACTION', 'Opening People side panel to locate off-screen presentation');
    dispatchFullClick(peopleBtn);

    for (let i = 0; i < 8; i++) {
      await sleep(50);
      if (this.isPeoplePanelOpen(doc)) {
        return true;
      }
    }
    return this.isPeoplePanelOpen(doc);
  }

  /**
   * Finds the presentation list item corresponding to participantName in the People panel.
   */
  public findPresentationItemInPeoplePanel(participantName: string, doc: Document = (typeof document !== 'undefined' ? document : ({} as any)), requirePresentation = true): HTMLElement | null {
    const normTarget = this.detector.normalizeParticipantName(participantName);
    const isTeacherSelf = MEET_DICTIONARY.TEACHER_SELF.KEYWORD.test(normTarget);
    if (!normTarget) return null;

    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) return null;

    const panel: any =
      MeetSelectors.findPeoplePanel(targetDoc) ||
      (targetDoc as any).body ||
      targetDoc;

    if (!panel || typeof panel.querySelectorAll !== 'function') return null;

    const presentationRegex = MEET_DICTIONARY.PRESENTATION.PRESENTATION_KEYWORD;

    const allButtons: HTMLElement[] = Array.from(panel.querySelectorAll('button, [role="button"]'));
    for (const btn of allButtons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        (aria.includes(normTarget) || aria.includes(participantName.toLowerCase()) || (isTeacherSelf && MEET_DICTIONARY.TEACHER_SELF.KEYWORD.test(aria))) &&
        (!requirePresentation || presentationRegex.test(aria))
      ) {
        const row =
          (typeof btn.closest === 'function' &&
            btn.closest('div[role="listitem"], [role="row"], div[data-participant-id]')) ||
          btn.parentElement?.parentElement ||
          btn.parentElement;
        if (row) return row as HTMLElement;
      }
    }

    const items: HTMLElement[] = Array.from(
      panel.querySelectorAll(
        'div[role="listitem"], li[role="listitem"], div[data-participant-id], div[data-requested-participant-id]'
      )
    ) as HTMLElement[];

    for (const item of items) {
      const text = item.textContent || '';
      const aria = item.getAttribute('aria-label') || '';
      const combined = `${text} ${aria}`.toLowerCase();
      const normCombined = this.detector.normalizeParticipantName(combined);

      if (normCombined.includes(normTarget) || combined.includes(participantName.toLowerCase()) || (isTeacherSelf && MEET_DICTIONARY.TEACHER_SELF.KEYWORD.test(combined))) {
        if (!requirePresentation) {
          return item;
        }

        if (presentationRegex.test(combined)) {
          return item;
        }

        const presChild = item.querySelector && item.querySelector(
          MEET_DICTIONARY.PRESENTATION.CHILD_SELECTOR
        );
        if (presChild) {
          const childText = (presChild.textContent || '').toLowerCase();
          const childAria = (presChild.getAttribute('aria-label') || '').toLowerCase();
          if (presentationRegex.test(childText) || presentationRegex.test(childAria)) {
            return item;
          }
        }
      }
    }

    return null;
  }

  /**
   * Finds the Pin button inside a People panel presentation row (if directly visible).
   */
  public findPinButtonInItem(item: HTMLElement): HTMLElement | null {
    if (!item.querySelectorAll) return null;
    const buttons = Array.from(item.querySelectorAll<HTMLElement>('button, [role="button"], div[tabindex="0"]'));
    const pinRegex = MEET_DICTIONARY.ACTIONS.PIN;

    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      const isUnpin = MEET_DICTIONARY.ACTIONS.UNPIN.test(aria) || MEET_DICTIONARY.ACTIONS.UNPIN.test(tooltip);
      if (isUnpin) continue;

      if (
        pinRegex.test(aria) ||
        pinRegex.test(tooltip) ||
        text.includes(MEET_DICTIONARY.ICONS.PIN) ||
        aria.includes(MEET_DICTIONARY.ICONS.PIN_OUTLINE) ||
        text.includes(MEET_DICTIONARY.ICONS.PIN_OUTLINE)
      ) {
        return btn;
      }
    }
    return null;
  }

  /**
   * Pins a participant's presentation reliably using Google Meet's People side panel.
   * Also returns a helper function to safely process the host menu (which will be done in the grid UI or main controller)
   */
  public async pinParticipant(participantName: string, doc: Document = (typeof document !== 'undefined' ? document : ({} as any)), requirePresentation = true): Promise<boolean> {
    const isOpen = await this.open(doc);
    if (!isOpen) {
      this.logger.log('WARN', `Failed to open People panel for pinning "${participantName}"`);
      return false;
    }

    let item: HTMLElement | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      item = this.findPresentationItemInPeoplePanel(participantName, doc, requirePresentation);
      if (item) break;
      await sleep(50);
    }

    if (!item && requirePresentation) {
      this.logger.log('WARN', `Could not find explicit presentation item in People panel for "${participantName}". Falling back to generic participant row.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        item = this.findPresentationItemInPeoplePanel(participantName, doc, false);
        if (item) break;
        await sleep(50);
      }
    }

    if (!item) {
      this.logger.log('WARN', `Could not find any participant item in People panel for "${participantName}"`);
      return false;
    }

    hoverTile(item);
    await sleep(30);

    let pinBtn = this.findPinButtonInItem(item);
    if (!pinBtn) {
      for (let i = 0; i < 3; i++) {
        await sleep(30);
        hoverTile(item);
        pinBtn = this.findPinButtonInItem(item);
        if (pinBtn) break;
      }
    }

    if (pinBtn) {
      this.logger.log('ACTION', `Dispatched direct Pin click in People panel for "${participantName}"`);
      dispatchFullClick(pinBtn);
      this.detector.setExpectedPinnedParticipant(participantName);
      return true;
    }

    const moreActionsBtn = Array.from(item.querySelectorAll<HTMLElement>('button, [role="button"]')).find((btn) => {
      const a = (btn.getAttribute('aria-label') || '').toLowerCase();
      const t = (btn.textContent || '').toLowerCase();
      return MEET_DICTIONARY.MORE_ACTIONS.test(a) || MEET_DICTIONARY.MORE_ACTIONS.test(t);
    });

    if (moreActionsBtn) {
      dispatchFullClick(moreActionsBtn);
      await sleep(100);

      const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
      if (!targetDoc) return false;
      const menus = Array.from(targetDoc.querySelectorAll<HTMLElement>('div[role="menu"], ul[role="menu"]'));
      
      let menuPin: HTMLElement | null = null;
      for (const menu of menus) {
        if (menu.offsetWidth === 0 && menu.offsetHeight === 0) continue;
        const menuItems = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"], li'));
        menuPin = menuItems.find((mi) => {
          const a = (mi.getAttribute('aria-label') || '').toLowerCase();
          const t = (mi.textContent || '').toLowerCase();
          return (
            (MEET_DICTIONARY.ACTIONS.PIN.test(a) || MEET_DICTIONARY.ACTIONS.PIN.test(t) || t.includes(MEET_DICTIONARY.ICONS.PIN_OUTLINE)) &&
            !MEET_DICTIONARY.ACTIONS.UNPIN.test(a) &&
            !MEET_DICTIONARY.ACTIONS.UNPIN.test(t)
          );
        }) || null;
        if (menuPin) break;
      }

      if (menuPin) {
        this.logger.log('ACTION', `Selected Pin option in More actions menu for "${participantName}"`);
        dispatchFullClick(menuPin);
        this.detector.setExpectedPinnedParticipant(participantName);
        return true;
      }
    }

    this.logger.log('WARN', `Pin button and More actions menu not found inside People panel item for "${participantName}"`);
    return false;
  }
}
