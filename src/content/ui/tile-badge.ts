import type { ScreenShare } from '../../types/index.ts';
import { AliasManager } from '../alias-manager.ts';

export const BADGE_CLASS = 'meet-switcher-student-badge';

export class TileBadgeDecorator {
  private aliasManager: AliasManager;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  public findTileNameElement(tile: HTMLElement): HTMLElement | null {
    if (!tile || typeof tile.querySelector !== 'function') return null;

    const isIconElement = (el: HTMLElement): boolean => {
      if (el.tagName === 'I') return true;
      const cls = typeof el.className === 'string' ? el.className : '';
      return (
        cls.includes('google-symbols') ||
        cls.includes('google-material-icons') ||
        cls.includes('material-icons')
      );
    };

    // 1. Google Meet standard name element in video tile: span.zWGUib
    const zwguib = tile.querySelector<HTMLElement>('span.zWGUib, div.zWGUib');
    if (zwguib && !isIconElement(zwguib)) return zwguib;

    // 2. Search candidates but strictly exclude <i> and material icons
    if (typeof tile.querySelectorAll === 'function') {
      const candidates = Array.from(
        tile.querySelectorAll<HTMLElement>('.notranslate, [data-self-name], span[title]')
      );
      for (const el of candidates) {
        if (isIconElement(el)) {
          continue;
        }
        const text = (el.textContent || '').trim();
        if (text && text.length > 1) {
          return el;
        }
      }
    } else {
      const fallback = tile.querySelector<HTMLElement>('.notranslate, [data-self-name], span[title]');
      if (fallback && !isIconElement(fallback)) return fallback;
    }

    return null;
  }

  public updateTile(share: ScreenShare): void {
    if (!share.tileElement || typeof share.tileElement.querySelector !== 'function') {
      return;
    }

    const alias = this.aliasManager.getAlias(share.participantName);

    // Clean up any accidental past injections on icon tags
    if (typeof share.tileElement.querySelectorAll === 'function') {
      const badIcons = share.tileElement.querySelectorAll('i[data-ms-original], i.google-symbols[data-ms-formatted]');
      for (const bad of Array.from(badIcons)) {
        bad.removeAttribute('data-ms-original');
        bad.removeAttribute('data-ms-formatted');
        (bad as HTMLElement).title = '';
      }
    }

    // Locate Google Meet's native name container inside the tile
    const nameEl = this.findTileNameElement(share.tileElement);

    if (nameEl) {
      // Remove any legacy floating badge
      share.tileElement.querySelector(`.${BADGE_CLASS}`)?.remove();

      const originalName = nameEl.getAttribute('data-ms-original') || share.participantName;

      if (alias) {
        nameEl.setAttribute('data-ms-original', originalName);
        const combinedText = `${alias} (${originalName})`;

        if (nameEl.getAttribute('data-ms-formatted') !== combinedText) {
          nameEl.setAttribute('data-ms-formatted', combinedText);
          nameEl.innerHTML = `<span class="ms-alias-name" style="font-weight: 600;">${this.escapeHtml(alias)}</span> <span class="ms-original-name" style="opacity: 0.75; font-weight: normal;">(${this.escapeHtml(originalName)})</span>`;
          nameEl.title = `MeetSwitcher: Псевдонім "${alias}" для "${originalName}"`;
        }
      } else if (nameEl.hasAttribute('data-ms-original')) {
        nameEl.textContent = originalName;
        nameEl.removeAttribute('data-ms-original');
        nameEl.removeAttribute('data-ms-formatted');
        nameEl.title = originalName;
      }
      return;
    }

    // Fallback: If native name container is absent (e.g. test mocks), mount minimal badge
    const existingBadge = share.tileElement.querySelector<HTMLElement>(`.${BADGE_CLASS}`);

    if (alias) {
      const badgeText = `${alias} (${share.participantName})`;

      if (existingBadge) {
        if (existingBadge.textContent !== badgeText) {
          existingBadge.textContent = badgeText;
        }
      } else {
        const badge = typeof document !== 'undefined' && typeof document.createElement === 'function'
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
