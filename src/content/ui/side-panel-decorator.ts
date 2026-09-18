import { AliasManager } from '../alias-manager.ts';

export const SIDE_PANEL_BADGE_CLASS = 'meet-switcher-sidepanel-badge';
export const SIDE_PANEL_ADD_BTN_CLASS = 'meet-switcher-sidepanel-add-btn';

export interface ParticipantRowInfo {
  name: string;
  isPresentation: boolean;
}

export class SidePanelDecorator {
  private aliasManager: AliasManager;
  private observer: MutationObserver | null = null;
  private debounceTimer: any = null;
  private intervalTimer: any = null;
  private scheduledTimers: Set<any> = new Set();
  private unsubscribeAlias: (() => void) | null = null;
  private clickListener: ((e: MouseEvent) => void) | null = null;
  private scrollListener: ((e: Event) => void) | null = null;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  private scheduleUpdate(delayMs: number, doc: Document): void {
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    if (!timerHost.setTimeout) return;
    const timer = timerHost.setTimeout(() => {
      this.scheduledTimers.delete(timer);
      this.update(doc);
    }, delayMs);
    this.scheduledTimers.add(timer);
  }

  private scheduleDebouncedUpdate(delayMs: number, doc: Document): void {
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    if (this.debounceTimer && timerHost.clearTimeout) {
      timerHost.clearTimeout(this.debounceTimer);
    }
    if (!timerHost.setTimeout) return;
    this.debounceTimer = timerHost.setTimeout(() => {
      this.debounceTimer = null;
      this.update(doc);
    }, delayMs);
  }

  public start(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    this.update(doc);

    // Staggered initial updates to handle delayed DOM rendering when joining/re-entering a meeting
    this.scheduleUpdate(200, doc);
    this.scheduleUpdate(600, doc);
    this.scheduleUpdate(1200, doc);
    this.scheduleUpdate(2500, doc);

    // Subscribe to alias changes
    this.unsubscribeAlias = this.aliasManager.onUpdate(() => {
      this.update(doc);
    });

    // Listen to user clicks on the page (e.g. clicking the People button in Meet toolbar)
    if (typeof doc.addEventListener === 'function') {
      this.clickListener = () => {
        this.scheduleDebouncedUpdate(80, doc);
        this.scheduleUpdate(250, doc);
        this.scheduleUpdate(600, doc);
      };
      doc.addEventListener('click', this.clickListener as any, true);

      this.scrollListener = () => {
        this.scheduleDebouncedUpdate(60, doc);
      };
      doc.addEventListener('scroll', this.scrollListener as any, { capture: true, passive: true } as any);
    }

    // Observe document for side panel mounting, opening, or row virtualization
    if (typeof MutationObserver !== 'undefined' && doc.body) {
      this.observer = new MutationObserver(() => {
        this.scheduleDebouncedUpdate(80, doc);
      });

      this.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-hidden', 'aria-pressed', 'aria-expanded', 'class', 'style', 'data-participant-id', 'data-requested-participant-id'],
        characterData: true,
      });
    }

    // Lightweight periodic heartbeat (1.5s) to guarantee persistent decoration during active call
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    if (timerHost.setInterval) {
      this.intervalTimer = timerHost.setInterval(() => {
        const panel = this.findPeoplePanel(doc);
        if (panel) {
          this.update(doc);
        }
      }, 1500);
    }
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.clickListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('click', this.clickListener as any, true);
      this.clickListener = null;
    }
    if (this.scrollListener && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
      document.removeEventListener('scroll', this.scrollListener as any, true);
      this.scrollListener = null;
    }
    const timerHost = typeof window !== 'undefined' ? window : (globalThis as any);
    if (this.debounceTimer && timerHost.clearTimeout) {
      timerHost.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer && timerHost.clearInterval) {
      timerHost.clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    for (const t of this.scheduledTimers) {
      if (timerHost.clearTimeout) timerHost.clearTimeout(t);
    }
    this.scheduledTimers.clear();

    if (this.unsubscribeAlias) {
      this.unsubscribeAlias();
      this.unsubscribeAlias = null;
    }
    this.restoreAllOriginalNames();
  }

  public findPeoplePanel(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): HTMLElement | null {
    if (!doc || typeof doc.querySelector !== 'function') return null;

    return (
      doc.querySelector<HTMLElement>('aside[aria-label*="Side panel" i], aside') ||
      doc.querySelector<HTMLElement>('div[aria-label*="People" i], div[aria-label*="учасник" i], div[aria-label*="люди" i]') ||
      doc.querySelector<HTMLElement>('[aria-label="In call"], [aria-label*="дзвінк" i], [aria-label*="вызов" i]') ||
      null
    );
  }

  public findParticipantRows(panel: HTMLElement): HTMLElement[] {
    if (!panel || typeof panel.querySelectorAll !== 'function') return [];

    const rows = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'div[role="listitem"], [role="row"], div[data-participant-id], div[data-requested-participant-id], li[role="listitem"]'
      )
    );
    if (rows.length > 0) return rows;

    // Fallback: child containers that have participant buttons
    const buttons = Array.from(panel.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const detectedRows = new Set<HTMLElement>();
    for (const btn of buttons) {
      const parentRow =
        (typeof btn.closest === 'function' && btn.closest('[role="listitem"], [role="row"]')) ||
        btn.parentElement?.parentElement;
      if (parentRow && parentRow !== panel && panel.contains(parentRow)) {
        detectedRows.add(parentRow as HTMLElement);
      }
    }
    return Array.from(detectedRows);
  }

  /**
   * Accurately finds the real name text element inside a Google Meet People panel row.
   * Strictly avoids icon tags (<i>), avatar containers (.BEaVse, .extHU), and action buttons.
   */
  public findNameElement(row: HTMLElement): HTMLElement | null {
    if (!row || typeof row.querySelector !== 'function') return null;

    const isIconElement = (el: HTMLElement): boolean => {
      if (el.tagName === 'I') return true;
      const cls = typeof el.className === 'string' ? el.className : '';
      return (
        cls.includes('google-symbols') ||
        cls.includes('google-material-icons') ||
        cls.includes('material-icons')
      );
    };

    // 1. Google Meet standard name element in People panel: <span class="zWGUib">
    const zwguib = row.querySelector<HTMLElement>('span.zWGUib, .jKwXVe span.zWGUib, .zSX24d .jKwXVe span');
    if (zwguib && !isIconElement(zwguib)) return zwguib;

    // 2. Search inside the text container .zSX24d
    const container = row.querySelector<HTMLElement>('.zSX24d, .jKwXVe');
    if (container) {
      const textSpan = container.querySelector<HTMLElement>('span');
      if (textSpan && !isIconElement(textSpan)) {
        return textSpan;
      }
    }

    // 3. Fallback: Search all candidate spans while strictly excluding icons and avatar
    const candidates = Array.from(
      row.querySelectorAll<HTMLElement>('.zSX24d span, span.notranslate, span[title], span')
    );
    const isPresentationWord = (t: string) => /^(?:presentation|презентація|презентация|трансляція)$/i.test(t);
    for (const el of candidates) {
      if (
        isIconElement(el) ||
        (el.closest && el.closest('.BEaVse, .extHU, .Q2qrwf, button, [role="button"]'))
      ) {
        continue;
      }
      const txt = (el.textContent || '').trim();
      if (
        txt &&
        !isPresentationWord(txt) &&
        !txt.startsWith('more_vert') &&
        !txt.startsWith('devices') &&
        !txt.startsWith('Mute')
      ) {
        return el;
      }
    }

    return null;
  }

  public isSystemPhrase(text: string): boolean {
    if (!text || text.length <= 1) return true;
    const lower = text.toLowerCase().trim();
    return (
      /^(?:presentation|презентація|презентация|трансляція)$/i.test(lower) ||
      /^(?:more actions|more options|додаткові дії|більше дій|другие параметры)$/i.test(lower) ||
      /^(?:more_vert|devices|keep_outline|present_to_all)$/i.test(lower) ||
      /^(?:на головному екрані|на главном экране|to your main screen)$/i.test(lower) ||
      /^(?:мікрофон вимкнено|микрофон отключен|microphone is off)$/i.test(lower) ||
      /^(?:закріпити|закрепить|відкріпити|открепить|pin|unpin)$/i.test(lower) ||
      /^(?:користувача|пользователя)$/i.test(lower)
    );
  }

  public cleanParticipantName(rawName: string): string {
    if (!rawName) return '';
    return rawName
      .replace(/^(?:користувач(?:а|ка)?|пользовател(?:я)?|user)\s*:\s*/i, '')
      .replace(/^(?:користувач(?:а|ка)?|пользовател(?:я)?)\s+/i, '')
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*|трансляція\s*:\s*)/i, '')
      .replace(/\s*\(?(?:презентація|presentation|презентация|трансляція)\)?$/i, '')
      .replace(/'s presentation$/i, '')
      .replace(/'s microphone$/i, '')
      .replace(/\s*\((?:You|Ви|Вы)\)$/i, '')
      .replace(/\s*\((?:Meeting host|Організатор зустрічі|Организатор встречи)\)$/i, '')
      .trim();
  }

  public extractParticipantInfo(row: HTMLElement): ParticipantRowInfo | null {
    if (!row || typeof row.querySelectorAll !== 'function') return null;

    const presentationRegex = /(?:presentation|презентац|present_to_all|трансляц)/i;
    const rowText = (row.textContent || '') + ' ' + (row.getAttribute('aria-label') || '');
    const buttons = Array.from(row.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const buttonLabels = buttons.map((b) => b.getAttribute('aria-label') || b.getAttribute('data-tooltip') || '').join(' ');
    const isPresentation = presentationRegex.test(rowText + ' ' + buttonLabels);

    const nameEl = this.findNameElement(row);
    if (nameEl && nameEl.getAttribute('data-ms-original')) {
      return {
        name: nameEl.getAttribute('data-ms-original')!,
        isPresentation,
      };
    }

    let rawName = '';

    // 1. Authoritative name from Google Meet name text element (.zWGUib)
    if (nameEl && nameEl.textContent) {
      const candidate = this.cleanParticipantName(nameEl.textContent);
      if (candidate && !this.isSystemPhrase(candidate)) {
        rawName = candidate;
      }
    }

    // 2. Row aria-label (e.g. <div role="listitem" aria-label="Bohdan Rubakha">)
    if (!rawName) {
      const rowAria = (row.getAttribute('aria-label') || '').trim();
      if (rowAria) {
        const candidate = this.cleanParticipantName(rowAria);
        if (candidate && !this.isSystemPhrase(candidate)) {
          rawName = candidate;
        }
      }
    }

    // 3. Fallback: Parse rich button aria-labels if name element was absent or obscured
    if (!rawName) {
      for (const btn of buttons) {
        const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '';
        if (!label) continue;

        // "Mute Bohdan Rubakha's microphone" / "Вимкнути мікрофон для користувача Bohdan Rubakha"
        const muteMatch = label.match(
          /(?:Mute|Вимкнути мікрофон для|Вимкнути мікрофон|Вимкнути звук трансляції для|Отключить микрофон для|Отключить микрофон)\s+(?:користувача\s+|пользователя\s+)?(.+?)(?:'s microphone|'s presentation|\s+презентацію|\s+трансляцію|\s+презентацию|\s+трансляцию|$)/i
        );
        if (muteMatch && muteMatch[1]) {
          const candidate = this.cleanParticipantName(muteMatch[1]);
          if (candidate && !this.isSystemPhrase(candidate)) {
            rawName = candidate;
            break;
          }
        }

        // "More options for Bohdan Rubakha" / "Додаткові дії для користувача Bohdan Rubakha"
        const moreMatch = label.match(
          /(?:More options for|More actions for|Більше дій для|Додаткові дії для|Другие параметры для|Дії для)\s+(?:користувача\s+|пользователя\s+)?(.+)/i
        );
        if (moreMatch && moreMatch[1]) {
          const candidate = this.cleanParticipantName(moreMatch[1]);
          if (candidate && !this.isSystemPhrase(candidate)) {
            rawName = candidate;
            break;
          }
        }

        // "Pin Bohdan Rubakha to your main screen" / "Закріпити користувача Bohdan Rubakha на головному екрані"
        const pinMatch = label.match(
          /(?:Pin|Закріпити|Закрепить)\s+(?:користувача\s+|пользователя\s+)?(.+?)(?:'s presentation|\s+to your main screen|\s+на головному екрані|\s+на главном экране|\s+на екрані|$)/i
        );
        if (pinMatch && pinMatch[1]) {
          const candidate = this.cleanParticipantName(pinMatch[1]);
          if (candidate && !this.isSystemPhrase(candidate)) {
            rawName = candidate;
            break;
          }
        }
      }
    }

    if (!rawName) return null;

    const cleanedName = this.cleanParticipantName(rawName);
    if (!cleanedName || this.isSystemPhrase(cleanedName)) return null;

    return {
      name: cleanedName,
      isPresentation,
    };
  }

  public update(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    const panel = this.findPeoplePanel(doc);
    const target = panel || (doc && doc.body ? doc.body : null);
    if (!target) return;

    const rows = this.findParticipantRows(target as HTMLElement);
    for (const row of rows) {
      this.decorateRow(row);
    }
  }

  public decorateRow(row: HTMLElement): void {
    // 1. Clean up any accidental past injections on icons or avatar tags
    const badIcons = row.querySelectorAll('i[data-ms-original], i.google-symbols[data-ms-formatted], .extHU i');
    for (const bad of Array.from(badIcons)) {
      bad.removeAttribute('data-ms-original');
      bad.removeAttribute('data-ms-formatted');
      (bad as HTMLElement).title = '';
    }
    row.querySelector(`.${SIDE_PANEL_BADGE_CLASS}`)?.remove();
    row.querySelector(`.${SIDE_PANEL_ADD_BTN_CLASS}`)?.remove();

    const info = this.extractParticipantInfo(row);
    if (!info || !info.name) return;

    const nameEl = this.findNameElement(row);
    if (!nameEl) return;

    const originalName = nameEl.getAttribute('data-ms-original') || info.name;
    const alias = this.aliasManager.getAlias(originalName);

    if (alias) {
      nameEl.setAttribute('data-ms-original', originalName);

      const presTag = info.isPresentation ? ' (презентація)' : '';
      const combinedText = `${alias} (${originalName})${presTag}`;

      // Self-healing check: verify BOTH that data-ms-formatted matches AND .ms-alias-name is currently in DOM
      const hasAliasSpan =
        typeof nameEl.querySelector === 'function' &&
        nameEl.querySelector('.ms-alias-name') !== null;
      const hasFormattedAttr = nameEl.getAttribute('data-ms-formatted') === combinedText;

      if (!hasAliasSpan || !hasFormattedAttr) {
        nameEl.setAttribute('data-ms-formatted', combinedText);
        const presHtml = info.isPresentation
          ? ` <span class="ms-pres-tag" style="opacity: 0.72; font-weight: normal;">(презентація)</span>`
          : '';
        nameEl.innerHTML = `<span class="ms-alias-name" style="font-weight: 500;">${this.escapeHtml(alias)}</span> <span class="ms-original-name" style="opacity: 0.72; font-weight: normal;">(${this.escapeHtml(originalName)})</span>${presHtml}`;
        nameEl.title = `MeetSwitcher: Псевдонім "${alias}" для "${originalName}". Натисніть двічі, щоб змінити.`;

        // Double click allows quick alias editing
        if (!(nameEl as any)._hasMsDblClick) {
          (nameEl as any)._hasMsDblClick = true;
          nameEl.addEventListener('dblclick', async (e: any) => {
            e.stopPropagation();
            e.preventDefault();
            const win = typeof window !== 'undefined' ? window : null;
            if (win && typeof win.prompt === 'function') {
              const newAlias = win.prompt(`Змінити псевдонім для "${originalName}":`, alias);
              if (newAlias !== null) {
                await this.aliasManager.setAlias(originalName, newAlias.trim());
              }
            }
          });
        }
      }
    } else if (nameEl.hasAttribute('data-ms-original')) {
      nameEl.textContent = originalName;
      nameEl.removeAttribute('data-ms-original');
      nameEl.removeAttribute('data-ms-formatted');
      nameEl.title = originalName;
    }
  }

  private restoreAllOriginalNames(): void {
    if (typeof document === 'undefined') return;
    const modifiedElements = document.querySelectorAll<HTMLElement>('[data-ms-original]');
    modifiedElements.forEach((el) => {
      if (el.tagName === 'I') {
        el.removeAttribute('data-ms-original');
        el.removeAttribute('data-ms-formatted');
        return;
      }
      const orig = el.getAttribute('data-ms-original');
      if (orig) {
        el.textContent = orig;
      }
      el.removeAttribute('data-ms-original');
      el.removeAttribute('data-ms-formatted');
    });
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
