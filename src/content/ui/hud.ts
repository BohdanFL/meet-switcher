import { ScreenShare } from '../../types';
import { PinController } from '../pin-controller';
import { DraggableHud } from './drag-drop';
import { AliasManager } from '../alias-manager';
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
  private aliasManager: AliasManager;
  private editingShareId: string | null = null;

  constructor(controller: PinController) {
    this.controller = controller;
    this.aliasManager = AliasManager.getInstance();
    this.aliasManager.onUpdate(() => this.renderList());

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

  private onToggleWallHandler?: () => void;
  private onToggleDemoHandler?: () => void;
  private onToggleTurboHandler?: () => void;
  private isDemoActive = false;
  private isDemoVisible = false;
  private isTurboActive = true;

  public setShowDemo(visible: boolean): void {
    this.isDemoVisible = visible;
    const demoBtn = this.shadow.querySelector<HTMLButtonElement>('.btn-demo-pill');
    if (demoBtn) {
      demoBtn.style.display = visible ? 'inline-flex' : 'none';
    }

    const demoFooterHint = this.shadow.querySelector<HTMLElement>('.hud-footer-demo-hint');
    if (demoFooterHint) {
      demoFooterHint.style.display = visible ? 'inline' : 'none';
    }

    const emptyDemoBtn = this.shadow.querySelector<HTMLElement>('.empty-state-demo-btn');
    if (emptyDemoBtn) {
      emptyDemoBtn.style.display = visible ? 'inline-block' : 'none';
    }
  }

  public getShadowRoot(): ShadowRoot {
    return this.shadow;
  }

  public setOnToggleWall(handler: () => void): void {
    this.onToggleWallHandler = handler;
  }

  public setOnToggleDemo(handler: () => void): void {
    this.onToggleDemoHandler = handler;
  }

  public setOnToggleTurbo(handler: () => void): void {
    this.onToggleTurboHandler = handler;
  }

  public getIsDemoActive(): boolean {
    return this.isDemoActive;
  }

  public getIsTurboActive(): boolean {
    return this.isTurboActive;
  }

  public setDemoActive(active: boolean): void {
    this.isDemoActive = active;
    const demoBtn = this.shadow.querySelector<HTMLButtonElement>('.btn-demo-pill');
    if (demoBtn) {
      demoBtn.classList.toggle('active', active);
      demoBtn.innerHTML = active ? '🧪 Демо ON' : '🧪 Демо';
      demoBtn.title = active
        ? 'Вимкнути Демо-режим (Alt + Shift + D)'
        : 'Увімкнути Демо-режим: 9 учнів (Alt + Shift + D)';
    }
    this.renderBadge();
    this.renderList();
  }

  public setTurboActive(active: boolean): void {
    this.isTurboActive = active;
    const speedBtn = this.shadow.querySelector<HTMLButtonElement>('.speed-btn');
    if (speedBtn) {
      speedBtn.classList.toggle('active', active);
      speedBtn.title = active
        ? 'Турбо-режим активний: анімації Google Meet вимкнено (Alt + A)'
        : 'Увімкнути Турбо-режим: прибрати анімації Google Meet (Alt + A)';
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
          <button class="icon-btn speed-btn active" title="Турбо-режим активний: анімації Google Meet вимкнено (Alt + A)">⚡</button>
          <button class="btn-demo-pill" style="display: none;" title="Тестовий демо-режим: 9 учнів (Alt + Shift + D)">🧪 Демо</button>
          <button class="icon-btn wall-btn" title="Стіна класу / Огляд (Alt + W)">⊞</button>
          <button class="icon-btn toggle-btn" title="Згорнути / Розгорнути">─</button>
        </div>
      </div>
      <div class="hud-body">
        <div class="screen-list-wrap"></div>
      </div>
      <div class="hud-footer">
        <span><kbd>Alt+W</kbd> Стіна</span>
        <span class="hud-footer-demo-hint" style="display: none;"><kbd>Alt+Shift+D</kbd> Демо</span>
        <span><kbd>Alt+0</kbd> Відкріп</span>
      </div>
    `;

    this.shadow.appendChild(this.containerEl);

    this.badgeEl = this.containerEl.querySelector<HTMLElement>('.hud-badge')!;
    this.listEl = this.containerEl.querySelector<HTMLElement>('.screen-list-wrap')!;
    this.toggleBtn = this.containerEl.querySelector<HTMLButtonElement>('.toggle-btn')!;

    const speedBtn = this.containerEl.querySelector<HTMLButtonElement>('.speed-btn')!;
    speedBtn.addEventListener('click', () => {
      if (this.onToggleTurboHandler) {
        this.onToggleTurboHandler();
      }
    });

    const wallBtn = this.containerEl.querySelector<HTMLButtonElement>('.wall-btn')!;
    wallBtn.addEventListener('click', () => {
      if (this.onToggleWallHandler) {
        this.onToggleWallHandler();
      }
    });

    const demoBtn = this.containerEl.querySelector<HTMLButtonElement>('.btn-demo-pill')!;
    demoBtn.addEventListener('click', () => {
      if (this.onToggleDemoHandler) {
        this.onToggleDemoHandler();
      }
    });

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
    if (this.isDemoActive) {
      this.badgeEl.textContent = 'Демо: 9 учнів';
      this.badgeEl.classList.add('has-screens');
    } else if (count === 0) {
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
          <button class="empty-state-demo-btn" style="${this.isDemoVisible ? 'display: inline-block;' : 'display: none;'}">
            🧪 Запустити Демо-режим (9 учнів)
          </button>
        </div>
      `;

      const emptyDemo = this.listEl.querySelector<HTMLButtonElement>('.empty-state-demo-btn');
      if (emptyDemo) {
        emptyDemo.addEventListener('click', () => {
          if (this.onToggleDemoHandler) {
            this.onToggleDemoHandler();
          }
        });
      }
      return;
    }

    const hasPinned = this.currentShares.some((s) => s.isPinned);

    // Dynamic unpin button in header
    let unpinHeaderBtn = this.shadow.querySelector<HTMLButtonElement>('.unpin-header-btn');
    if (hasPinned) {
      if (!unpinHeaderBtn) {
        unpinHeaderBtn = document.createElement('button');
        unpinHeaderBtn.className = 'icon-btn unpin-header-btn';
        unpinHeaderBtn.title = 'Відкріпити активний екран (Alt + 0)';
        unpinHeaderBtn.style.color = '#f28b82';
        unpinHeaderBtn.innerHTML = '✕';
        unpinHeaderBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.controller.unpin();
        });
        const actionsEl = this.shadow.querySelector('.hud-actions');
        if (actionsEl) {
          actionsEl.insertBefore(unpinHeaderBtn, actionsEl.firstChild);
        }
      }
    } else if (unpinHeaderBtn) {
      unpinHeaderBtn.remove();
    }

    const ul = document.createElement('ul');
    ul.className = 'screen-list';

    for (const share of this.currentShares) {
      const li = document.createElement('li');
      li.className = `screen-item ${share.isPinned ? 'pinned' : ''}`;
      const isEditing = this.editingShareId === share.id;
      const alias = this.aliasManager.getAlias(share.participantName);
      const displayName = this.aliasManager.formatDisplayName(share.participantName);

      li.title = share.isPinned
        ? `Активний. Натисніть, щоб ВІДКРІПИТИ (Alt + 0)`
        : `Закріпити екран: ${displayName} (Alt + ${share.index})`;

      if (isEditing) {
        li.innerHTML = `
          <div class="screen-info">
            <span class="screen-number">${share.index}</span>
            <div class="inline-edit-wrap">
              <input class="rename-input" type="text" value="${this.escapeHtml(alias || '')}" placeholder="Ім'я учня...">
              <button class="rename-action-btn save-btn" title="Зберегти (Enter)">✓</button>
              <button class="rename-action-btn cancel-btn" title="Скасувати (Esc)">✕</button>
            </div>
          </div>
        `;

        const input = li.querySelector<HTMLInputElement>('.rename-input')!;
        const saveBtn = li.querySelector<HTMLButtonElement>('.save-btn')!;
        const cancelBtn = li.querySelector<HTMLButtonElement>('.cancel-btn')!;

        const save = async () => {
          const val = input.value.trim();
          this.editingShareId = null;
          await this.aliasManager.setAlias(share.participantName, val);
          this.renderList();
        };

        const cancel = () => {
          this.editingShareId = null;
          this.renderList();
        };

        input.addEventListener('click', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            save();
          } else if (e.key === 'Escape') {
            cancel();
          }
        });

        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          save();
        });

        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          cancel();
        });

        setTimeout(() => {
          input.focus();
          input.select();
        }, 10);
      } else {
        li.innerHTML = `
          <div class="screen-info">
            <span class="screen-number">${share.index}</span>
            <div class="screen-name-wrap">
              <span class="screen-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
              ${alias ? '<span class="alias-tag" title="Встановлено псевдонім">🏷️</span>' : ''}
              <button class="btn-rename" title="Перейменувати учня (встановити псевдонім)">✏️</button>
            </div>
          </div>
          <div class="screen-status">
            ${share.isPinned ? '📌' : '🖥️'}
          </div>
        `;

        const renameBtn = li.querySelector<HTMLButtonElement>('.btn-rename');
        if (renameBtn) {
          renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.editingShareId = share.id;
            this.renderList();
          });
        }

        li.addEventListener('click', () => {
          this.controller.switchToShare(share);
        });
      }

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
