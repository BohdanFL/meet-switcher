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
  private debounceTimer: number | null = null;
  private unsubscribeAlias: (() => void) | null = null;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  public start(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    this.update(doc);

    // Subscribe to alias changes
    this.unsubscribeAlias = this.aliasManager.onUpdate(() => {
      this.update(doc);
    });

    // Observe document for side panel mounting, opening, or row virtualization
    if (typeof MutationObserver !== 'undefined' && doc.body) {
      this.observer = new MutationObserver(() => {
        if (this.debounceTimer) {
          window.clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = window.setTimeout(() => {
          this.update(doc);
        }, 100);
      });

      this.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });
    }
  }

  public stop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.debounceTimer && typeof window !== 'undefined') {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.unsubscribeAlias) {
      this.unsubscribeAlias();
      this.unsubscribeAlias = null;
    }
    this.restoreAllOriginalNames();
  }

  public findPeoplePanel(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): HTMLElement | null {
    if (!doc || typeof doc.querySelector !== 'function') return null;

    return (
      doc.querySelector<HTMLElement>('[aria-label="In call"], [aria-label*="дзвінк" i], [aria-label*="вызов" i]') ||
      doc.querySelector<HTMLElement>('aside[aria-label*="Side panel" i], aside') ||
      doc.querySelector<HTMLElement>('div[aria-label*="People" i], div[aria-label*="учасник" i], div[aria-label*="люди" i]') ||
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

  public extractParticipantInfo(row: HTMLElement): ParticipantRowInfo | null {
    if (!row || typeof row.querySelectorAll !== 'function') return null;

    // First check if nameEl already has stored data-ms-original
    const nameEl =
      row.querySelector<HTMLElement>('.notranslate') ||
      row.querySelector<HTMLElement>('span[title], div[title]') ||
      row.querySelector<HTMLElement>('span');

    if (nameEl && nameEl.getAttribute('data-ms-original')) {
      const stored = nameEl.getAttribute('data-ms-original')!;
      const rowText = (row.textContent || '') + ' ' + (row.getAttribute('aria-label') || '');
      const isPresentation = /(?:presentation|презентац|present_to_all|трансляц)/i.test(rowText);
      return {
        name: stored,
        isPresentation,
      };
    }

    const buttons = Array.from(row.querySelectorAll<HTMLElement>('button, [role="button"]'));
    const presentationRegex = /(?:presentation|презентац|present_to_all|трансляц)/i;
    let rawName = '';
    let isPresentation = false;

    // 1. Check buttons inside row for rich aria-labels
    for (const btn of buttons) {
      const label = btn.getAttribute('aria-label') || btn.getAttribute('data-tooltip') || '';
      if (!label) continue;

      if (presentationRegex.test(label)) {
        isPresentation = true;
      }

      // "Mute Bohdan Rubakha's microphone" / "Mute Bohdan Rubakha's presentation"
      const muteMatch = label.match(
        /(?:Mute|Вимкнути мікрофон для користувача|Вимкнути мікрофон для|Вимкнути мікрофон|Вимкнути звук трансляції для користувача|Вимкнути звук трансляції для)\s+(.+?)(?:'s microphone|'s presentation|\s+презентацію|\s+трансляцію|$)/i
      );
      if (muteMatch && muteMatch[1]) {
        rawName = muteMatch[1];
        break;
      }

      // "More options for Bohdan Rubakha" / "More actions for Bohdan Rubakha" / "Додаткові дії для ..."
      const moreMatch = label.match(
        /(?:More options for|More actions for|Більше дій для|Додаткові дії для|Другие параметры для|Дії для)\s+(.+)/i
      );
      if (moreMatch && moreMatch[1]) {
        rawName = moreMatch[1];
        break;
      }

      // "Pin Bohdan Rubakha to your main screen"
      const pinMatch = label.match(
        /(?:Pin|Закріпити)\s+(.+?)(?:'s presentation|\s+to your main screen|\s+на головному екрані|\s+на екрані|$)/i
      );
      if (pinMatch && pinMatch[1]) {
        rawName = pinMatch[1];
        break;
      }
    }

    // 2. Check .notranslate elements inside row
    if (!rawName && nameEl && nameEl.textContent) {
      rawName = nameEl.textContent;
    }

    // 3. Fallback: Parse inner text of row excluding buttons
    if (!rawName) {
      const clone = typeof row.cloneNode === 'function' ? (row.cloneNode(true) as HTMLElement) : null;
      if (clone && typeof clone.querySelectorAll === 'function') {
        clone.querySelectorAll('button, [role="button"], i, svg').forEach((el) => el.remove?.());
        const text = (clone.textContent || '').trim();
        if (text) {
          const cleaned = text
            .replace(/\s*\((?:You|Ви|Вы)\)/i, '')
            .replace(/\s*(?:Meeting host|Організатор зустрічі|Организатор встречи)/i, '')
            .split('\n')[0]
            .trim();
          if (cleaned) {
            rawName = cleaned;
          }
        }
      } else {
        const text = (row.textContent || '').trim();
        if (text) {
          rawName = text
            .replace(/\s*\((?:You|Ви|Вы)\)/i, '')
            .replace(/\s*(?:Meeting host|Організатор зустрічі|Организатор встречи)/i, '')
            .split('\n')[0]
            .trim();
        }
      }
    }

    if (!rawName) return null;

    const rowText = (row.textContent || '') + ' ' + (row.getAttribute('aria-label') || '');
    if (presentationRegex.test(rowText)) {
      isPresentation = true;
    }

    const cleanedName = rawName
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*)/i, '')
      .replace(/\s*\(презентація\)$/i, '')
      .replace(/\s*\(presentation\)$/i, '')
      .replace(/'s presentation$/i, '')
      .replace(/'s microphone$/i, '')
      .replace(/\s*\((?:You|Ви|Вы)\)$/i, '')
      .trim();

    return {
      name: cleanedName,
      isPresentation,
    };
  }

  public update(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    const panel = this.findPeoplePanel(doc);
    if (!panel) return;

    const rows = this.findParticipantRows(panel);
    for (const row of rows) {
      this.decorateRow(row);
    }
  }

  public decorateRow(row: HTMLElement): void {
    const info = this.extractParticipantInfo(row);
    if (!info || !info.name) return;

    // Clean up any legacy badge elements from previous versions
    row.querySelector(`.${SIDE_PANEL_BADGE_CLASS}`)?.remove();
    row.querySelector(`.${SIDE_PANEL_ADD_BTN_CLASS}`)?.remove();

    const nameEl =
      row.querySelector<HTMLElement>('.notranslate') ||
      row.querySelector<HTMLElement>('span[title], div[title]') ||
      row.querySelector<HTMLElement>('span');

    if (!nameEl) return;

    const originalName = nameEl.getAttribute('data-ms-original') || info.name;
    const alias = this.aliasManager.getAlias(originalName);

    if (alias) {
      nameEl.setAttribute('data-ms-original', originalName);

      const combinedText = info.isPresentation
        ? `${alias} (${originalName}) (презентація)`
        : `${alias} (${originalName})`;

      if (nameEl.getAttribute('data-ms-formatted') !== combinedText) {
        nameEl.setAttribute('data-ms-formatted', combinedText);
        nameEl.innerHTML = info.isPresentation
          ? `<span class="ms-alias-name" style="font-weight: 500;">${this.escapeHtml(alias)}</span> <span class="ms-original-name" style="opacity: 0.72; font-weight: normal;">(${this.escapeHtml(originalName)})</span> <span class="ms-pres-tag" style="opacity: 0.6; font-size: 0.9em;">(презентація)</span>`
          : `<span class="ms-alias-name" style="font-weight: 500;">${this.escapeHtml(alias)}</span> <span class="ms-original-name" style="opacity: 0.72; font-weight: normal;">(${this.escapeHtml(originalName)})</span>`;

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
