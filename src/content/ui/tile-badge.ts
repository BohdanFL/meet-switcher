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
    const existingBadge = share.tileElement.querySelector<HTMLElement>(`.${BADGE_CLASS}`);

    if (alias) {
      const displayName = this.aliasManager.formatDisplayName(share.participantName);
      const badgeText = `🏷️ ${displayName}`;

      if (existingBadge) {
        if (existingBadge.textContent !== badgeText) {
          existingBadge.textContent = badgeText;
        }
        if (typeof document !== 'undefined' && share.tileElement.appendChild && !share.tileElement.contains(existingBadge)) {
          share.tileElement.appendChild(existingBadge);
        }
      } else {
        const badge = typeof document !== 'undefined' && typeof document.createElement === 'function'
          ? document.createElement('div')
          : ({ style: {} } as any);
        badge.className = BADGE_CLASS;
        badge.textContent = badgeText;
        if ('title' in badge) {
          badge.title = `Псевдонім учня: ${alias} (Акаунт: ${share.participantName})`;
        }

        // Inline CSS styles to guarantee appearance regardless of Google Meet CSS
        Object.assign(badge.style, {
          position: 'absolute',
          top: '12px',
          left: '12px',
          zIndex: '9999',
          background: 'rgba(15, 17, 23, 0.88)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          color: '#ffffff',
          padding: '4px 10px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '500',
          fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
          letterSpacing: '0.2px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          pointerEvents: 'none',
          transition: 'opacity 0.2s ease',
        });

        // Ensure container is positioned for absolute child
        try {
          if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const currentPos = window.getComputedStyle(share.tileElement).position;
            if (!currentPos || currentPos === 'static') {
              share.tileElement.style.position = 'relative';
            }
          }
        } catch {
          // Ignore computed style errors
        }

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
    }
  }
}
