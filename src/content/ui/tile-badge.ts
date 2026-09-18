import type { ScreenShare } from '../../types/index.ts';
import { AliasManager } from '../alias-manager.ts';

export const BADGE_CLASS = 'meet-switcher-student-badge';

export class TileBadgeDecorator {
  private aliasManager: AliasManager;
  private observer: MutationObserver | null = null;
  private debounceTimer: number | null = null;
  private unsubscribeAlias: (() => void) | null = null;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  public isIconElement(el: HTMLElement): boolean {
    if (!el) return false;
    if (el.tagName === 'I') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return (
      cls.includes('google-symbols') ||
      cls.includes('google-material-icons') ||
      cls.includes('material-icons')
    );
  }

  public cleanTileName(rawText: string): { name: string; isPresentation: boolean } {
    if (!rawText) return { name: '', isPresentation: false };
    const presentationRegex = /(?:\(presentation\)|\(презентація\)|\(презентация\))/i;
    const isPresentation = presentationRegex.test(rawText);
    const name = rawText
      .replace(presentationRegex, '')
      .replace(/\s*\((?:You|Ви|Вы)\)$/i, '')
      .trim();
    return { name, isPresentation };
  }

  public start(doc: Document = (typeof document !== 'undefined' ? document : ({} as any))): void {
    this.updateAll(doc);

    this.unsubscribeAlias = this.aliasManager.onUpdate(() => {
      this.updateAll(doc);
    });

    if (typeof MutationObserver !== 'undefined' && doc?.body) {
      this.observer = new MutationObserver(() => {
        if (this.debounceTimer && typeof window !== 'undefined') {
          window.clearTimeout(this.debounceTimer);
        }
        const timerHost = typeof window !== 'undefined' ? window : ({} as any);
        this.debounceTimer =
          timerHost.setTimeout?.(() => {
            this.updateAll(doc);
          }, 80) || null;
      });

      this.observer.observe(doc.body, {
        childList: true,
        subtree: true,
        characterData: true,
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
    this.destroy();
  }

  public findAllTileNameElements(
    root: Document | HTMLElement = (typeof document !== 'undefined' ? document : ({} as any))
  ): HTMLElement[] {
    if (!root || typeof root.querySelectorAll !== 'function') return [];

    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.XEazBc span.notranslate, .XEazBc span, .LqxiJe span.notranslate, .OFfHfd span.notranslate, span.zWGUib'
      )
    );

    const validElements: HTMLElement[] = [];
    for (const el of candidates) {
      if (this.isIconElement(el)) continue;

      // Exclude People side panel rows or avatar circles
      if (typeof el.closest === 'function') {
        if (el.closest('.BEaVse, .extHU, aside, [role="listitem"]')) {
          continue;
        }
      }

      const text = (el.textContent || '').trim();
      if (text && text.length > 0) {
        validElements.push(el);
      }
    }

    return validElements;
  }

  public decorateTileNameElement(nameEl: HTMLElement, overrideOriginalName?: string): void {
    if (!nameEl) return;

    // Clean up any legacy misplaced attributes on icon children
    if (this.isIconElement(nameEl)) {
      nameEl.removeAttribute('data-ms-original');
      nameEl.removeAttribute('data-ms-formatted');
      nameEl.removeAttribute('data-ms-is-presentation');
      return;
    }

    const storedOriginal = nameEl.getAttribute('data-ms-original');
    const storedIsPres = nameEl.getAttribute('data-ms-is-presentation') === 'true';
    const rawText = nameEl.textContent || '';
    const cleanFromRaw = this.cleanTileName(rawText);
    const isPresentation = storedIsPres || cleanFromRaw.isPresentation;

    const originalName = storedOriginal || overrideOriginalName || cleanFromRaw.name;
    if (!originalName) return;

    const alias = this.aliasManager.getAlias(originalName);

    if (alias) {
      nameEl.setAttribute('data-ms-original', originalName);
      nameEl.setAttribute('data-ms-is-presentation', isPresentation ? 'true' : 'false');

      const presTagText = isPresentation ? ' (презентація)' : '';
      const combinedText = `${alias} (${originalName})${presTagText}`;

      // Self-healing check: verify BOTH that data-ms-formatted matches AND .ms-alias-name is currently in DOM
      const hasAliasSpan =
        typeof nameEl.querySelector === 'function' &&
        nameEl.querySelector('.ms-alias-name') !== null;
      const hasFormattedAttr = nameEl.getAttribute('data-ms-formatted') === combinedText;

      if (!hasAliasSpan || !hasFormattedAttr) {
        nameEl.setAttribute('data-ms-formatted', combinedText);
        const presHtml = isPresentation
          ? ` <span class="ms-pres-tag" style="opacity: 0.65; font-size: 0.9em; font-weight: normal;">(презентація)</span>`
          : '';
        nameEl.innerHTML = `<span class="ms-alias-name" style="font-weight: 600;">${this.escapeHtml(alias)}</span> <span class="ms-original-name" style="opacity: 0.75; font-weight: normal;">(${this.escapeHtml(originalName)})</span>${presHtml}`;
        nameEl.title = `MeetSwitcher: Псевдонім "${alias}" для "${originalName}". Натисніть двічі, щоб змінити.`;

        // Update hover tooltip sibling if present in Google Meet structure
        const tooltipContainer =
          typeof nameEl.closest === 'function'
            ? nameEl.closest('[data-is-tooltip-wrapper="true"]')
            : null;
        if (tooltipContainer && typeof tooltipContainer.querySelector === 'function') {
          const tooltipEl = tooltipContainer.querySelector<HTMLElement>('[role="tooltip"]');
          if (tooltipEl) {
            tooltipEl.textContent = combinedText;
          }
        }

        // Double-click inline alias editing
        if (!(nameEl as any)._hasMsDblClick && typeof nameEl.addEventListener === 'function') {
          (nameEl as any)._hasMsDblClick = true;
          nameEl.addEventListener('dblclick', async (e: any) => {
            e.stopPropagation();
            e.preventDefault();
            const win = typeof window !== 'undefined' ? window : null;
            if (win && typeof win.prompt === 'function') {
              const newAlias = win.prompt(
                `Введіть новий псевдонім для "${originalName}" (або залиште порожнім, щоб видалити):`,
                alias
              );
              if (newAlias !== null) {
                if (newAlias.trim()) {
                  await this.aliasManager.setAlias(originalName, newAlias.trim());
                } else {
                  await this.aliasManager.removeAlias(originalName);
                }
              }
            }
          });
        }
      }
    } else if (nameEl.hasAttribute('data-ms-original')) {
      const presTagText = isPresentation ? ' (презентація)' : '';
      nameEl.textContent = originalName + presTagText;
      nameEl.removeAttribute('data-ms-original');
      nameEl.removeAttribute('data-ms-formatted');
      nameEl.removeAttribute('data-ms-is-presentation');
      nameEl.title = originalName;

      const tooltipContainer =
        typeof nameEl.closest === 'function'
          ? nameEl.closest('[data-is-tooltip-wrapper="true"]')
          : null;
      if (tooltipContainer && typeof tooltipContainer.querySelector === 'function') {
        const tooltipEl = tooltipContainer.querySelector<HTMLElement>('[role="tooltip"]');
        if (tooltipEl) {
          tooltipEl.textContent = originalName + presTagText;
        }
      }
    }
  }

  public updateAll(
    doc: Document = (typeof document !== 'undefined' ? document : ({} as any))
  ): void {
    const elements = this.findAllTileNameElements(doc);
    for (const el of elements) {
      this.decorateTileNameElement(el);
    }
  }

  public findTileNameElement(tile: HTMLElement): HTMLElement | null {
    if (!tile || typeof tile.querySelector !== 'function') return null;

    // 1. Google Meet standard name element in tile: .XEazBc span
    const xeazbcSpan = tile.querySelector<HTMLElement>('.XEazBc span.notranslate, .XEazBc span');
    if (xeazbcSpan && !this.isIconElement(xeazbcSpan)) return xeazbcSpan;

    // 2. Standard Google Meet name element: span.zWGUib
    const zwguib = tile.querySelector<HTMLElement>('span.zWGUib, div.zWGUib');
    if (zwguib && !this.isIconElement(zwguib)) return zwguib;

    // 3. Search candidates excluding icons
    if (typeof tile.querySelectorAll === 'function') {
      const candidates = Array.from(
        tile.querySelectorAll<HTMLElement>('.notranslate, [data-self-name], span[title]')
      );
      for (const el of candidates) {
        if (this.isIconElement(el)) {
          continue;
        }
        const text = (el.textContent || '').trim();
        if (text && text.length > 1) {
          return el;
        }
      }
    } else {
      const fallback = tile.querySelector<HTMLElement>('.notranslate, [data-self-name], span[title]');
      if (fallback && !this.isIconElement(fallback)) return fallback;
    }

    return null;
  }

  public updateTile(share: ScreenShare): void {
    if (!share.tileElement || typeof share.tileElement.querySelector !== 'function') {
      return;
    }

    // Clean up legacy floating badges if present
    share.tileElement.querySelector(`.${BADGE_CLASS}`)?.remove();

    const nameEl = this.findTileNameElement(share.tileElement);
    if (nameEl) {
      this.decorateTileNameElement(nameEl, share.participantName);
      return;
    }

    // Fallback: If native name container is absent (e.g. minimal test mocks), mount minimal badge
    const alias = this.aliasManager.getAlias(share.participantName);
    const existingBadge = share.tileElement.querySelector<HTMLElement>(`.${BADGE_CLASS}`);

    if (alias) {
      const badgeText = `${alias} (${share.participantName})`;
      if (existingBadge) {
        if (existingBadge.textContent !== badgeText) {
          existingBadge.textContent = badgeText;
        }
      } else {
        const badge =
          typeof document !== 'undefined' && typeof document.createElement === 'function'
            ? document.createElement('div')
            : ({ style: {} } as any);
        badge.className = BADGE_CLASS;
        badge.textContent = badgeText;
        share.tileElement.appendChild(badge);
      }
    } else if (existingBadge) {
      existingBadge.remove();
    }
  }

  public updateBadges(shares: ScreenShare[]): void {
    for (const share of shares) {
      this.updateTile(share);
    }
    // Also run updateAll across document so webcam / participant tiles are updated
    if (typeof document !== 'undefined') {
      this.updateAll(document);
    }
  }

  public destroy(): void {
    if (typeof document !== 'undefined') {
      const badges = document.querySelectorAll(`.${BADGE_CLASS}`);
      badges.forEach((b) => b.remove());

      const modified = document.querySelectorAll<HTMLElement>('[data-ms-original]');
      modified.forEach((el) => {
        if (el.tagName === 'I') {
          el.removeAttribute('data-ms-original');
          el.removeAttribute('data-ms-formatted');
          return;
        }
        const orig = el.getAttribute('data-ms-original');
        if (orig) el.textContent = orig;
        el.removeAttribute('data-ms-original');
        el.removeAttribute('data-ms-formatted');
      });
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

