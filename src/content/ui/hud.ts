import { ScreenShare } from '../../types';
import { PinController } from '../pin-controller';
import { DraggableHud } from './drag-drop';
import hudStyles from './styles.css?inline';

export class SwitcherHud {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private controller: PinController;
  private draggable: DraggableHud | null = null;
  private containerEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private listEl!: HTMLElement;
  private toggleBtn!: HTMLButtonElement;
  private isCollapsed = false;
  private currentShares: ScreenShare[] = [];

  constructor(controller: PinController) {
    this.controller = controller;

    // 1. Create host element
    this.host = document.createElement('meet-switcher-host');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    // 2. Inject scoped CSS
    const styleEl = document.createElement('style');
    styleEl.textContent = hudStyles;
    this.shadow.appendChild(styleEl);

    // 3. Build DOM skeleton
    this.buildSkeleton();

    // 4. Attach to document body
    document.body.appendChild(this.host);

    // 5. Initialize Drag & Drop
    const headerEl = this.shadow.querySelector<HTMLElement>('.hud-header');
    if (headerEl) {
      this.draggable = new DraggableHud(this.host, headerEl);
      if (this.draggable.getState().collapsed) {
        this.toggleCollapse(true);
      }
    }
  }

  /**
   * Update the list of displayed screen shares.
   */
  public update(shares: ScreenShare[]): void {
    this.currentShares = shares;
    this.renderBadge();
    this.renderList();
  }

  /**
   * Remove the HUD from the DOM.
   */
  public destroy(): void {
    if (this.host.parentElement) {
      this.host.parentElement.removeChild(this.host);
    }
  }

  private buildSkeleton(): void {
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'hud-container';

    this.containerEl.innerHTML = `
      <div class="hud-header">
        <div class="hud-title-wrap">
          <span class="drag-handle">⠿</span>
          <span class="hud-title">MeetSwitcher</span>
          <span class="hud-badge">0 екранів</span>
        </div>
        <div class="hud-actions">
          <button class="icon-btn toggle-btn" title="Згорнути / Розгорнути">─</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="screen-list-wrap"></div>
      </div>
      <div class="hud-footer">
        <span>Перехід: <kbd>Alt</kbd>+<kbd>1..9</kbd></span>
        <span>Коло: <kbd>Alt</kbd>+<kbd>←</kbd><kbd>→</kbd></span>
      </div>
    `;

    this.shadow.appendChild(this.containerEl);

    this.badgeEl = this.containerEl.querySelector<HTMLElement>('.hud-badge')!;
    this.listEl = this.containerEl.querySelector<HTMLElement>('.screen-list-wrap')!;
    this.toggleBtn = this.containerEl.querySelector<HTMLButtonElement>('.toggle-btn')!;

    this.toggleBtn.addEventListener('click', () => {
      this.toggleCollapse(!this.isCollapsed);
    });
  }

  private toggleCollapse(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    this.containerEl.classList.toggle('collapsed', this.isCollapsed);
    this.toggleBtn.textContent = this.isCollapsed ? '+' : '─';
    if (this.draggable) {
      this.draggable.setCollapsed(this.isCollapsed);
    }
  }

  private renderBadge(): void {
    const count = this.currentShares.length;
    if (count === 0) {
      this.badgeEl.textContent = '0 екранів';
      this.badgeEl.classList.remove('has-screens');
    } else {
      this.badgeEl.textContent = `${count} ${count === 1 ? 'екран' : 'екрани'}`;
      this.badgeEl.classList.add('has-screens');
    }
  }

  private renderList(): void {
    if (this.currentShares.length === 0) {
      this.listEl.innerHTML = `
        <div class="empty-state">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
          <div>Очікування презентацій...</div>
          <div style="font-size: 11px; opacity: 0.7; margin-top: 2px;">Учні ще не поширили екран</div>
        </div>
      `;
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'screen-list';

    for (const share of this.currentShares) {
      const li = document.createElement('li');
      li.className = `screen-item ${share.isPinned ? 'pinned' : ''}`;
      li.title = `Закріпити екран: ${share.participantName} (Alt + ${share.index})`;

      li.innerHTML = `
        <div class="screen-info">
          <span class="screen-number">${share.index}</span>
          <span class="screen-name">${this.escapeHtml(share.participantName)}</span>
        </div>
        <div class="screen-status">
          ${share.isPinned ? '📌' : '🖥️'}
        </div>
      `;

      li.addEventListener('click', () => {
        this.controller.switchToShare(share);
      });

      ul.appendChild(li);
    }

    this.listEl.innerHTML = '';
    this.listEl.appendChild(ul);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
