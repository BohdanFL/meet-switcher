import { ScreenShare } from '../../types';
import { AliasManager } from '../alias-manager';

interface WallCardItem {
  cardEl: HTMLElement;
  videoEl: HTMLVideoElement;
  share: ScreenShare;
  numberEl: HTMLElement;
  nameEl: HTMLElement;
  statusEl: HTMLElement;
}

export class ClassroomWall {
  private shadow: ShadowRoot;
  private onSelectShare: (share: ScreenShare) => void;
  private overlayEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private isVisible = false;
  private currentShares: ScreenShare[] = [];
  private cardsMap: Map<string, WallCardItem> = new Map();
  private onToggleDemoHandler?: () => void;
  private isDemoVisible = false;
  private aliasManager: AliasManager;

  constructor(shadow: ShadowRoot, onSelectShare: (share: ScreenShare) => void) {
    this.shadow = shadow;
    this.onSelectShare = onSelectShare;
    this.aliasManager = AliasManager.getInstance();
    this.aliasManager.onUpdate(() => {
      if (this.isVisible) {
        this.render();
      }
    });
    this.buildOverlay();
  }

  public setShowDemo(visible: boolean): void {
    this.isDemoVisible = visible;
    const headerDemoBtn = this.overlayEl?.querySelector<HTMLButtonElement>('.wall-demo-header-btn');
    if (headerDemoBtn) {
      headerDemoBtn.style.display = visible ? 'inline-flex' : 'none';
    }
    const emptyDemoBtn = this.gridEl?.querySelector<HTMLButtonElement>('.wall-empty-demo-btn');
    if (emptyDemoBtn) {
      emptyDemoBtn.style.display = visible ? 'inline-block' : 'none';
    }
  }

  public setOnToggleDemo(handler: () => void): void {
    this.onToggleDemoHandler = handler;
  }

  public isOpen(): boolean {
    return this.isVisible;
  }

  public toggle(shares?: ScreenShare[]): void {
    if (this.isVisible) {
      this.close();
    } else {
      this.open(shares);
    }
  }

  public open(shares?: ScreenShare[]): void {
    if (shares) {
      this.currentShares = shares;
    }
    this.isVisible = true;
    this.overlayEl.classList.add('active');
    this.render();
  }

  public close(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.overlayEl.classList.remove('active');
    this.cleanupVideos();
  }

  public updateShares(shares: ScreenShare[]): void {
    this.currentShares = shares;
    if (this.isVisible) {
      this.render();
    }
  }

  private buildOverlay(): void {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'classroom-wall-overlay';

    this.overlayEl.innerHTML = `
      <div class="classroom-wall-header">
        <div class="wall-header-title">
          <span class="wall-title-text">⊞ Classroom Wall • Огляд екранів</span>
          <span class="wall-badge">0 екранів</span>
          <button class="btn-demo-pill wall-demo-header-btn" style="display: none;" title="Тестовий демо-режим: 9 учнів (Alt + Shift + D)">🧪 Демо</button>
        </div>
        <div class="wall-header-hint">
          Клікніть по плитці, щоб закріпити учня • Закрити: <kbd>Esc</kbd> або <kbd>Alt+W</kbd>
        </div>
        <button class="wall-close-btn" title="Закрити огляд (Escape)">
          ✕ Закрити
        </button>
      </div>
      <div class="classroom-wall-body">
        <div class="wall-grid"></div>
      </div>
    `;

    this.shadow.appendChild(this.overlayEl);

    this.gridEl = this.overlayEl.querySelector<HTMLElement>('.wall-grid')!;
    this.badgeEl = this.overlayEl.querySelector<HTMLElement>('.wall-badge')!;

    const closeBtn = this.overlayEl.querySelector<HTMLButtonElement>('.wall-close-btn')!;
    closeBtn.addEventListener('click', () => this.close());

    const headerDemoBtn = this.overlayEl.querySelector<HTMLButtonElement>('.wall-demo-header-btn')!;
    headerDemoBtn.addEventListener('click', () => {
      if (this.onToggleDemoHandler) {
        this.onToggleDemoHandler();
      }
    });
  }

  private render(): void {
    const count = this.currentShares.length;
    this.badgeEl.textContent = `${count} ${count === 1 ? 'екран' : 'екранів'}`;

    if (count === 0) {
      this.cleanupVideos();
      this.gridEl.className = 'wall-grid cols-1';
      this.gridEl.innerHTML = `
        <div class="wall-empty">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <div>Немає активних демонстрацій екранів</div>
          <div style="font-size: 13px; margin-top: 6px; opacity: 0.7;">
            Очікування, поки учні поширять свої екрани
          </div>
          <button class="wall-empty-demo-btn" style="${this.isDemoVisible ? 'display: inline-block;' : 'display: none;'}">
            🧪 Запустити Демо-режим (9 учнів)
          </button>
        </div>
      `;

      const emptyDemo = this.gridEl.querySelector<HTMLButtonElement>('.wall-empty-demo-btn');
      if (emptyDemo) {
        emptyDemo.addEventListener('click', () => {
          if (this.onToggleDemoHandler) {
            this.onToggleDemoHandler();
          }
        });
      }
      return;
    }

    // Remove empty state message if present
    const emptyEl = this.gridEl.querySelector('.wall-empty');
    if (emptyEl) {
      emptyEl.remove();
    }

    this.gridEl.className = `wall-grid cols-${Math.min(10, count)}`;

    const currentIds = new Set(this.currentShares.map((s) => s.id));

    // 1. Remove cards for shares that are gone
    for (const [id, item] of this.cardsMap.entries()) {
      if (!currentIds.has(id)) {
        try {
          item.videoEl.pause();
          item.videoEl.srcObject = null;
          item.cardEl.remove();
        } catch {
          // Ignore detach errors
        }
        this.cardsMap.delete(id);
      }
    }

    // 2. Add or update cards
    for (const share of this.currentShares) {
      const existing = this.cardsMap.get(share.id);
      const displayName = this.aliasManager.formatDisplayName(share.participantName);

      if (existing) {
        // Update attributes without re-creating DOM or touching the playing video!
        existing.share = share;
        existing.cardEl.className = `wall-card ${share.isPinned ? 'pinned' : ''}`;
        existing.cardEl.title = `Закріпити екран ${displayName} (Alt + ${share.index})`;
        existing.numberEl.textContent = `${share.index}`;
        existing.nameEl.textContent = displayName;
        existing.statusEl.textContent = share.isPinned ? '📌 В центрі' : '';
        existing.statusEl.style.display = share.isPinned ? 'inline' : 'none';

        if (
          share.videoElement &&
          share.videoElement.srcObject &&
          existing.videoEl.srcObject !== share.videoElement.srcObject
        ) {
          existing.videoEl.srcObject = share.videoElement.srcObject;
          existing.videoEl.play().catch(() => {});
        }
      } else {
        // Create new card for this screen share
        const card = document.createElement('div');
        card.className = `wall-card ${share.isPinned ? 'pinned' : ''}`;
        card.title = `Закріпити екран ${displayName} (Alt + ${share.index})`;

        card.innerHTML = `
          <div class="wall-card-badge">
            <span class="wall-card-number">${share.index}</span>
            <span class="wall-card-name">${this.escapeHtml(displayName)}</span>
            <button class="wall-card-rename-btn" title="Перейменувати учня (встановити псевдонім)">✏️</button>
            <span class="wall-card-status" style="${share.isPinned ? '' : 'display: none;'}">📌 В центрі</span>
          </div>
          <div class="wall-video-wrap"></div>
        `;

        const badgeEl = card.querySelector<HTMLElement>('.wall-card-badge')!;
        const numberEl = card.querySelector<HTMLElement>('.wall-card-number')!;
        const nameEl = card.querySelector<HTMLElement>('.wall-card-name')!;
        const renameBtn = card.querySelector<HTMLButtonElement>('.wall-card-rename-btn')!;
        const statusEl = card.querySelector<HTMLElement>('.wall-card-status')!;
        const videoWrap = card.querySelector<HTMLElement>('.wall-video-wrap')!;

        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const currentAlias = this.aliasManager.getAlias(share.participantName) || '';

          badgeEl.innerHTML = `
            <span class="wall-card-number">${share.index}</span>
            <div class="wall-card-edit-wrap">
              <input class="wall-card-edit-input" type="text" value="${this.escapeHtml(currentAlias)}" placeholder="Ім'я учня...">
              <button class="rename-action-btn wall-save-btn" title="Зберегти (Enter)">✓</button>
              <button class="rename-action-btn wall-cancel-btn" title="Скасувати (Esc)">✕</button>
            </div>
          `;

          const input = badgeEl.querySelector<HTMLInputElement>('.wall-card-edit-input')!;
          const saveBtn = badgeEl.querySelector<HTMLButtonElement>('.wall-save-btn')!;
          const cancelBtn = badgeEl.querySelector<HTMLButtonElement>('.wall-cancel-btn')!;

          const save = async () => {
            const val = input.value.trim();
            await this.aliasManager.setAlias(share.participantName, val);
            this.render();
          };

          const cancel = () => {
            this.render();
          };

          input.addEventListener('click', (ev) => ev.stopPropagation());
          input.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') save();
            else if (ev.key === 'Escape') cancel();
          });
          saveBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            save();
          });
          cancelBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            cancel();
          });

          setTimeout(() => {
            input.focus();
            input.select();
          }, 10);
        });

        const previewVideo = document.createElement('video');
        previewVideo.autoplay = true;
        previewVideo.muted = true;
        previewVideo.playsInline = true;

        if (share.videoElement && share.videoElement.srcObject) {
          previewVideo.srcObject = share.videoElement.srcObject;
          previewVideo.play().catch(() => {});
        }

        videoWrap.appendChild(previewVideo);

        card.addEventListener('click', () => {
          this.close();
          this.onSelectShare(share);
        });

        this.gridEl.appendChild(card);

        this.cardsMap.set(share.id, {
          cardEl: card,
          videoEl: previewVideo,
          share,
          numberEl,
          nameEl,
          statusEl,
        });
      }
    }

    // Ensure grid DOM elements strictly match sorted shares order (1..N)
    for (const share of this.currentShares) {
      const item = this.cardsMap.get(share.id);
      if (item && item.cardEl.parentElement === this.gridEl) {
        this.gridEl.appendChild(item.cardEl);
      }
    }
  }

  /**
   * Free GPU resources and detach video streams when wall is closed.
   */
  private cleanupVideos(): void {
    for (const item of this.cardsMap.values()) {
      try {
        item.videoEl.pause();
        item.videoEl.srcObject = null;
        item.cardEl.remove();
      } catch {
        // Ignore detach errors
      }
    }
    this.cardsMap.clear();
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
