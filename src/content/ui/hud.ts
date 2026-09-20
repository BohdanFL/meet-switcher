import type { ScreenShare, ClassroomRosterState, RosterParticipant } from '../../types/index.ts';
import type { PinController } from '../pin-controller.ts';
import { DraggableHud } from './drag-drop.ts';
import { AliasManager } from '../alias-manager.ts';
import { getHudSkeletonHtml } from './hud-template.ts';
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
  private collapsedSections: Record<string, boolean> = {};
  private onRefreshRosterHandler?: () => void;
  public setOnRefreshRoster(handler: () => void): void {
    this.onRefreshRosterHandler = handler;
  }

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
  
  public async updateRoster(roster: ClassroomRosterState): Promise<void> {
    this.currentShares = roster.activeSharers.map(r => r.screenShare).filter(Boolean) as ScreenShare[];
    this.renderBadge();

    let wrapper = this.listEl.querySelector('.roster-wrapper');
    if (!wrapper) {
      this.listEl.innerHTML = '<div class="roster-wrapper"></div>';
      wrapper = this.listEl.querySelector('.roster-wrapper');
    }

    if (Object.keys(this.collapsedSections).length === 0) {
      try {
        const stored = await chrome.storage.local.get('meet_switcher_hud_collapsed_sections');
        this.collapsedSections = stored['meet_switcher_hud_collapsed_sections'] || {};
      } catch (e) {}
    }

    const buildSection = (key: string, title: string, count: number, participants: RosterParticipant[], renderItem: (p: RosterParticipant) => HTMLElement) => {
      let section = wrapper!.querySelector(`[data-section="${key}"]`);
      if (!section) {
        section = document.createElement('div');
        section.setAttribute('data-section', key);
        wrapper!.appendChild(section);
      }

      const isCollapsed = Boolean(this.collapsedSections[key]);
      
      let header = section.querySelector('.roster-section-header');
      if (!header) {
        header = document.createElement('div');
        header.className = 'roster-section-header';
        header.addEventListener('click', () => {
          this.collapsedSections[key] = !this.collapsedSections[key];
          try {
            chrome.storage.local.set({ 'meet_switcher_hud_collapsed_sections': this.collapsedSections });
          } catch(e) {}
          this.updateRoster(roster);
        });
        section.appendChild(header);
      }
      
      header.className = `roster-section-header ${isCollapsed ? 'collapsed' : ''}`;
      header.innerHTML = `
        <span style="display: flex; align-items: center; gap: 4px;">
          <span class="toggle-arrow">▾</span>
          ${this.escapeHtml(title)}
        </span>
        <span class="section-count">${count}</span>
      `;

      let content = section.querySelector('.roster-section-content');
      if (!content) {
        content = document.createElement('div');
        content.className = 'roster-section-content';
        section.appendChild(content);
      }
      content.className = `roster-section-content ${isCollapsed ? 'collapsed' : ''}`;

      const currentIds = new Set(participants.map(p => p.id));
      
      // Remove elements not in current roster
      Array.from(content.children).forEach((child: any) => {
        if (!currentIds.has(child.getAttribute('data-id') || '')) {
          child.remove();
        }
      });

      // Update / Append elements
      let insertIndex = 0;
      for (const p of participants) {
        let el = content.querySelector(`[data-id="${p.id}"]`) as HTMLElement;
        if (!el) {
          el = renderItem(p);
          el.setAttribute('data-id', p.id);
        } else {
          // Key-based state updates
          const isPinned = p.screenShare?.isPinned;
          const displayName = this.aliasManager.formatDisplayName(p.name);
          
          if (p.category === 'ACTIVE_SCREEN') {
            el.className = `screen-item item-screen ${isPinned ? 'pinned' : ''}`;
            const nameEl = el.querySelector('.screen-name');
            if (nameEl && nameEl.textContent !== displayName) {
              nameEl.textContent = displayName;
            }
            const statusEl = el.querySelector('.screen-status');
            if (statusEl) statusEl.textContent = isPinned ? '📌' : '🖥️';
          } else if (p.category === 'IN_CALL_NO_SCREEN' || p.category === 'GUEST') {
            const isPinnedNoScreen = p.isPinned;
            el.className = `screen-item ${p.category === 'GUEST' ? 'item-absent' : 'item-no-screen'} ${isPinnedNoScreen ? 'pinned' : ''}`;
            const statusEl = el.querySelector('.screen-status');
            if (statusEl) statusEl.textContent = isPinnedNoScreen ? '📌' : '👁️';
          }
        }

        if (content.children[insertIndex] !== el) {
          content.insertBefore(el, content.children[insertIndex]);
        }
        insertIndex++;
      }
    };

    buildSection('active', 'З екраном', roster.activeSharers.length, roster.activeSharers, (p) => {
      const share = p.screenShare;
      const li = document.createElement('div');
      li.className = `screen-item item-screen ${share?.isPinned ? 'pinned' : ''}`;
      const displayName = this.aliasManager.formatDisplayName(p.name);
      li.title = share?.isPinned ? 'Активний. Натисніть, щоб ВІДКРІПИТИ' : 'Закріпити екран';

      li.innerHTML = `
        <div class="screen-info">
          <span class="screen-number">${share?.index || '-'}</span>
          <div class="screen-name-wrap">
            <span class="screen-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
            ${p.isGuest ? '<span class="badge-guest">Гість</span>' : ''}
          </div>
        </div>
        <div class="screen-status">${share?.isPinned ? '📌' : '🖥️'}</div>
      `;
      
      if (share) {
         li.addEventListener('click', () => {
           this.controller.switchToShare(share);
         });
      }
      return li;
    });

    buildSection('inCall', 'Без екрана', roster.inCallNoScreen.length, roster.inCallNoScreen, (p) => {
      const li = document.createElement('div');
      const isPinned = p.isPinned;
      li.className = `screen-item item-no-screen ${isPinned ? 'pinned' : ''}`;
      
      const displayName = this.aliasManager.formatDisplayName(p.name);
      
      li.innerHTML = `
        <div class="screen-info" style="padding-left: 2px;">
          <div class="screen-name-wrap">
            <span class="screen-name" title="${this.escapeHtml(displayName)}">${this.escapeHtml(displayName)}</span>
            ${p.isGuest ? '<span class="badge-guest">Гість</span>' : ''}
          </div>
        </div>
        <div class="screen-status" style="font-size: 11px; opacity: 0.6;">${isPinned ? '📌' : '👁️'}</div>
      `;
      
      li.addEventListener('click', () => {
         const latestP = this.controller.getDetector().getScreenShares().find(s => s.participantName === p.name) ? null : p; 
         const isCurrentlyPinned = this.controller.getDetector().getGlobalPinnedParticipantName() === p.name ||
           this.controller.getDetector().normalizeParticipantName(this.controller.getDetector().getGlobalPinnedParticipantName() || '').includes(this.controller.getDetector().normalizeParticipantName(p.name));
         
         if (isCurrentlyPinned) {
           this.controller.unpinActiveStreams();
         } else {
           this.controller.pinViaPeoplePanel(p.name, document, false);
         }
      });
      return li;
    });

    buildSection('absent', 'Відсутні / Гості', roster.absentStudents.length, roster.absentStudents, (p) => {
      const li = document.createElement('div');
      const isPinned = p.isPinned;
      li.className = `screen-item item-absent ${isPinned ? 'pinned' : ''}`;
      li.innerHTML = `
        <div class="screen-info" style="padding-left: 2px;">
          <div class="screen-name-wrap">
            <span class="screen-name">${this.escapeHtml(p.name)}</span>
          </div>
        </div>
        <div class="screen-status" style="font-size: 11px; opacity: 0.6;">${isPinned ? '📌' : '👁️'}</div>
      `;
      
      li.addEventListener('click', () => {
         const isCurrentlyPinned = this.controller.getDetector().getGlobalPinnedParticipantName() === p.name ||
           this.controller.getDetector().normalizeParticipantName(this.controller.getDetector().getGlobalPinnedParticipantName() || '').includes(this.controller.getDetector().normalizeParticipantName(p.name));
         
         if (isCurrentlyPinned) {
           this.controller.unpinActiveStreams();
         } else {
           this.controller.pinViaPeoplePanel(p.name, document, false);
         }
      });
      return li;
    });

    this.updateHeaderUnpinButton();
  }

  private updateHeaderUnpinButton(): void {
    const hasPinned = this.currentShares.some((s) => s.isPinned);
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
  }


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
  private onToggleAttendanceHandler?: () => void;
  private isDemoActive = false;
  private isDemoVisible = false;
  private isTurboActive = true;

  public setOnToggleAttendance(handler: () => void): void {
    this.onToggleAttendanceHandler = handler;
  }

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
    this.containerEl.innerHTML = getHudSkeletonHtml();

    this.shadow.appendChild(this.containerEl);

    this.badgeEl = this.containerEl.querySelector<HTMLElement>('.hud-badge')!;
    this.listEl = this.containerEl.querySelector<HTMLElement>('.screen-list-wrap')!;
    this.toggleBtn = this.containerEl.querySelector<HTMLButtonElement>('.toggle-btn')!;

    const refreshBtn = this.containerEl.querySelector<HTMLButtonElement>('.btn-refresh-roster');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        if (this.onRefreshRosterHandler) this.onRefreshRosterHandler();
      });
    }

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

    const attendanceBtn = this.containerEl.querySelector<HTMLButtonElement>('.attendance-btn')!;
    attendanceBtn.addEventListener('click', () => {
      if (this.onToggleAttendanceHandler) {
        this.onToggleAttendanceHandler();
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
