import { AliasManager } from '../alias-manager.ts';

export const SIDE_PANEL_BADGE_CLASS = 'meet-switcher-sidepanel-badge';
export const SIDE_PANEL_ADD_BTN_CLASS = 'meet-switcher-sidepanel-add-btn';
export const SIDE_PANEL_STYLES_ID = 'meet-switcher-sidepanel-styles';

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
    this.injectStyles(doc);
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
        }, 120);
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
    this.destroyBadges();
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
    if (!rawName) {
      const notranslate = row.querySelector<HTMLElement>('.notranslate');
      if (notranslate && notranslate.textContent) {
        rawName = notranslate.textContent;
      }
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
      this.decorateRow(row, doc);
    }
  }

  public decorateRow(row: HTMLElement, doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    const info = this.extractParticipantInfo(row);
    if (!info || !info.name) return;

    const alias = this.aliasManager.getAlias(info.name);
    const existingBadge = row.querySelector<HTMLElement>(`.${SIDE_PANEL_BADGE_CLASS}`);
    const existingAddBtn = row.querySelector<HTMLElement>(`.${SIDE_PANEL_ADD_BTN_CLASS}`);

    // If alias exists:
    if (alias) {
      if (existingAddBtn) {
        existingAddBtn.remove();
      }

      const badgeLabel = info.isPresentation ? `🏷️ ${alias} (екран)` : `🏷️ ${alias}`;
      const badgeTitle = `MeetSwitcher: Псевдонім "${alias}" для "${info.name}". Натисніть, щоб змінити.`;

      if (existingBadge) {
        if (existingBadge.textContent !== badgeLabel) {
          existingBadge.textContent = badgeLabel;
        }
        existingBadge.title = badgeTitle;
        return;
      }

      // Create new badge element
      const badge = doc.createElement ? doc.createElement('span') : ({ style: {} } as any);
      badge.className = `${SIDE_PANEL_BADGE_CLASS}${info.isPresentation ? ' is-presentation' : ''}`;
      badge.textContent = badgeLabel;
      badge.title = badgeTitle;

      badge.addEventListener('click', async (e: any) => {
        e.stopPropagation();
        e.preventDefault();
        const win = typeof window !== 'undefined' ? window : null;
        if (win && typeof win.prompt === 'function') {
          const newAlias = win.prompt(`Змінити псевдонім для "${info.name}":`, alias);
          if (newAlias !== null) {
            await this.aliasManager.setAlias(info.name, newAlias.trim());
          }
        }
      });

      this.attachElementToRow(row, badge);
    } else {
      // No alias: remove existing badge if present
      if (existingBadge) {
        existingBadge.remove();
      }

      // Do not add "+🏷️" on presentation rows, only on person rows
      if (info.isPresentation) {
        if (existingAddBtn) existingAddBtn.remove();
        return;
      }

      if (!existingAddBtn && doc.createElement) {
        const addBtn = doc.createElement('button');
        addBtn.className = SIDE_PANEL_ADD_BTN_CLASS;
        addBtn.title = `Встановити псевдонім для "${info.name}"`;
        addBtn.textContent = '+🏷️';

        addBtn.addEventListener('click', async (e: any) => {
          e.stopPropagation();
          e.preventDefault();
          const win = typeof window !== 'undefined' ? window : null;
          if (win && typeof win.prompt === 'function') {
            const newAlias = win.prompt(`Встановити псевдонім для "${info.name}":`);
            if (newAlias && newAlias.trim()) {
              await this.aliasManager.setAlias(info.name, newAlias.trim());
            }
          }
        });

        this.attachElementToRow(row, addBtn);
      }
    }
  }

  private attachElementToRow(row: HTMLElement, element: HTMLElement): void {
    // Prefer inserting right after name element (.notranslate, span[title], etc.)
    const nameEl =
      row.querySelector<HTMLElement>('.notranslate') ||
      row.querySelector<HTMLElement>('span[title], div[title]') ||
      row.querySelector<HTMLElement>('span');

    if (nameEl && nameEl.parentElement) {
      if (typeof nameEl.insertAdjacentElement === 'function') {
        nameEl.insertAdjacentElement('afterend', element);
      } else {
        nameEl.parentElement.appendChild(element);
      }
    } else {
      row.appendChild(element);
    }
  }

  private injectStyles(doc: Document): void {
    if (!doc || !doc.head || typeof doc.getElementById !== 'function' || doc.getElementById(SIDE_PANEL_STYLES_ID)) {
      return;
    }

    const style = doc.createElement('style');
    style.id = SIDE_PANEL_STYLES_ID;
    style.textContent = `
      .${SIDE_PANEL_BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: rgba(26, 115, 232, 0.16);
        color: #8ab4f8;
        border: 1px solid rgba(138, 180, 248, 0.35);
        border-radius: 4px;
        padding: 1px 6px;
        font-size: 11px;
        font-weight: 500;
        line-height: 16px;
        margin-left: 6px;
        cursor: pointer;
        user-select: none;
        vertical-align: middle;
        transition: all 0.15s ease;
        z-index: 2;
      }
      .${SIDE_PANEL_BADGE_CLASS}:hover {
        background: rgba(26, 115, 232, 0.3);
        border-color: #8ab4f8;
        color: #ffffff;
      }
      .${SIDE_PANEL_BADGE_CLASS}.is-presentation {
        background: rgba(52, 168, 83, 0.16);
        color: #81c995;
        border-color: rgba(129, 201, 149, 0.35);
      }
      .${SIDE_PANEL_BADGE_CLASS}.is-presentation:hover {
        background: rgba(52, 168, 83, 0.3);
        border-color: #81c995;
        color: #ffffff;
      }
      .${SIDE_PANEL_ADD_BTN_CLASS} {
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.7);
        border: 1px dashed rgba(255, 255, 255, 0.25);
        border-radius: 4px;
        padding: 0 5px;
        font-size: 10px;
        margin-left: 6px;
        cursor: pointer;
        line-height: 14px;
        vertical-align: middle;
        transition: all 0.15s ease;
        z-index: 2;
      }
      div[role="listitem"]:hover .${SIDE_PANEL_ADD_BTN_CLASS},
      [role="row"]:hover .${SIDE_PANEL_ADD_BTN_CLASS},
      div[data-participant-id]:hover .${SIDE_PANEL_ADD_BTN_CLASS} {
        display: inline-flex;
      }
      .${SIDE_PANEL_ADD_BTN_CLASS}:hover {
        background: rgba(26, 115, 232, 0.25);
        color: #8ab4f8;
        border-color: #8ab4f8;
      }
    `;
    doc.head.appendChild(style);
  }

  private destroyBadges(): void {
    if (typeof document !== 'undefined') {
      document.querySelectorAll(`.${SIDE_PANEL_BADGE_CLASS}, .${SIDE_PANEL_ADD_BTN_CLASS}`).forEach((el) => el.remove());
      document.getElementById(SIDE_PANEL_STYLES_ID)?.remove();
    }
  }
}
