import { ScreenShare } from '../../types';

export class ClassroomWall {
  private shadow: ShadowRoot;
  private onSelectShare: (share: ScreenShare) => void;
  private overlayEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private isVisible = false;
  private currentShares: ScreenShare[] = [];
  private previewVideos: HTMLVideoElement[] = [];
  private onToggleDemoHandler?: () => void;

  constructor(shadow: ShadowRoot, onSelectShare: (share: ScreenShare) => void) {
    this.shadow = shadow;
    this.onSelectShare = onSelectShare;
    this.buildOverlay();
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
          <button class="btn-demo-pill wall-demo-header-btn" title="Тестовий демо-режим: 9 учнів (Alt + Shift + D)">🧪 Демо</button>
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
    this.cleanupVideos();

    const count = this.currentShares.length;
    this.badgeEl.textContent = `${count} ${count === 1 ? 'екран' : 'екранів'}`;

    if (count === 0) {
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
          <button class="wall-empty-demo-btn">
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

    this.gridEl.className = `wall-grid cols-${Math.min(10, count)}`;
    this.gridEl.innerHTML = '';

    for (const share of this.currentShares) {
      const card = document.createElement('div');
      card.className = `wall-card ${share.isPinned ? 'pinned' : ''}`;
      card.title = `Закріпити екран ${share.participantName} (Alt + ${share.index})`;

      card.innerHTML = `
        <div class="wall-card-header">
          <div class="wall-card-title">
            <span class="wall-card-number">${share.index}</span>
            <span class="wall-card-name">${this.escapeHtml(share.participantName)}</span>
          </div>
          <div class="wall-card-status">
            ${share.isPinned ? '📌 В центрі' : '🖥️'}
          </div>
        </div>
        <div class="wall-video-wrap">
          <div class="wall-hover-overlay">
            🔍 Натисніть для закріплення
          </div>
        </div>
      `;

      const videoWrap = card.querySelector<HTMLElement>('.wall-video-wrap')!;
      const previewVideo = document.createElement('video');
      previewVideo.autoplay = true;
      previewVideo.muted = true;
      previewVideo.playsInline = true;

      // Zero-copy stream mirroring directly from Meet's active video
      if (share.videoElement && share.videoElement.srcObject) {
        previewVideo.srcObject = share.videoElement.srcObject;
        previewVideo.play().catch(() => {
          // Playback error handling
        });
      }

      this.previewVideos.push(previewVideo);
      videoWrap.appendChild(previewVideo);

      card.addEventListener('click', () => {
        this.close();
        this.onSelectShare(share);
      });

      this.gridEl.appendChild(card);
    }
  }

  /**
   * Free GPU resources and detach video streams when wall is closed.
   */
  private cleanupVideos(): void {
    for (const video of this.previewVideos) {
      try {
        video.pause();
        video.srcObject = null;
        video.remove();
      } catch {
        // Ignore detach errors
      }
    }
    this.previewVideos = [];
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
