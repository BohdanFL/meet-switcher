import type { ScreenShare } from '../../types/index.ts';
import { AliasManager } from '../alias-manager.ts';

export const BADGE_CLASS = 'meet-switcher-student-badge';

export class TileBadgeDecorator {
  private aliasManager: AliasManager;

  constructor(aliasManager?: AliasManager) {
    this.aliasManager = aliasManager || AliasManager.getInstance();
  }

  public updateTile(share: ScreenShare): void {
    if (!share.tileElement || typeof share.tileElement.querySelector !== 'function') {
      return;
    }

    const alias = this.aliasManager.getAlias(share.participantName);

    // Locate Google Meet's native name container inside the tile
    const nameEl =
      share.tileElement.querySelector<HTMLElement>('.notranslate, [data-self-name], span.zWGUib') ||
      share.tileElement.querySelector<HTMLElement>('div.notranslate, span[title]');

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
