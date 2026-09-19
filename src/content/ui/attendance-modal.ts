import { GroupStore } from '../attendance/group-store.ts';
import { AttendanceTracker } from '../attendance/attendance-tracker.ts';
import type { StudentGroup } from '../../types/attendance.ts';

export class AttendanceModal {
  private shadow: ShadowRoot;
  private store: GroupStore;
  private tracker: AttendanceTracker;
  private overlayEl!: HTMLElement;
  private isVisible = false;
  private activeGroup: StudentGroup | null = null;
  private currentActiveNames: string[] = [];

  constructor(shadow: ShadowRoot, store: GroupStore = GroupStore.getInstance()) {
    this.shadow = shadow;
    this.store = store;
    this.tracker = new AttendanceTracker();
    if (typeof document !== 'undefined') {
      this.buildModal();
    }
  }

  public getActiveGroup(): StudentGroup | null {
    return this.activeGroup;
  }

  public isOpen(): boolean {
    return this.isVisible;
  }

  public open(group?: StudentGroup): void {
    if (group) {
      this.activeGroup = group;
    }
    this.isVisible = true;
    if (this.overlayEl) {
      this.overlayEl.classList.add('active');
    }
    this.render();
  }

  public close(): void {
    this.isVisible = false;
    if (this.overlayEl) {
      this.overlayEl.classList.remove('active');
    }
  }

  public update(activeNames: string[]): void {
    this.currentActiveNames = activeNames;
    if (this.isVisible) {
      this.render();
    }
  }

  public async setSelectedGroup(groupId: string): Promise<void> {
    const group = await this.store.getGroup(groupId);
    if (group) {
      this.activeGroup = group;
      this.tracker.clearOverrides();
      this.render();
    }
  }

  private buildModal(): void {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'attendance-modal-overlay';
    this.overlayEl.innerHTML = `
      <div class="attendance-dialog">
        <div class="attendance-header">
          <div class="attendance-title-wrap">
            <span class="attendance-icon">📋</span>
            <span class="attendance-title">Відвідуваність</span>
            <select class="attendance-group-select"></select>
          </div>
          <button class="attendance-close-btn" title="Закрити (Esc)">✕</button>
        </div>
        <div class="attendance-stats">
          <span class="stat-present">🟢 Присутні: <b class="stat-present-count">0</b></span>
          <span class="stat-absent">🔴 Відсутні: <b class="stat-absent-count">0</b></span>
          <span class="stat-total">Всього: <b class="stat-total-count">0</b></span>
        </div>
        <div class="attendance-body">
          <div class="attendance-list"></div>
        </div>
        <div class="attendance-footer">
          <button class="attendance-copy-btn">
            📋 Скопіювати для менеджера
          </button>
        </div>
      </div>
    `;

    this.shadow.appendChild(this.overlayEl);

    // Event listeners
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.close();
      }
    });

    const closeBtn = this.overlayEl.querySelector('.attendance-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    const groupSelect = this.overlayEl.querySelector<HTMLSelectElement>('.attendance-group-select');
    groupSelect?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value;
      if (val) {
        this.setSelectedGroup(val);
      }
    });

    const copyBtn = this.overlayEl.querySelector<HTMLButtonElement>('.attendance-copy-btn');
    copyBtn?.addEventListener('click', () => this.copyReport());
  }

  private async render(): Promise<void> {
    if (!this.overlayEl) return;

    const allGroups = await this.store.getAllGroups();
    const groupList = Object.values(allGroups);

    const selectEl = this.overlayEl.querySelector<HTMLSelectElement>('.attendance-group-select');
    if (selectEl) {
      selectEl.innerHTML = '';
      if (groupList.length === 0) {
        selectEl.innerHTML = '<option value="">Немає імпортованих груп (відкрийте LMS)</option>';
      } else {
        for (const g of groupList) {
          const opt = document.createElement('option');
          opt.value = g.id;
          opt.textContent = g.name;
          if (this.activeGroup && this.activeGroup.id === g.id) {
            opt.selected = true;
          }
          selectEl.appendChild(opt);
        }
      }
    }

    if (!this.activeGroup && groupList.length > 0) {
      this.activeGroup = groupList[0];
    }

    const listEl = this.overlayEl.querySelector<HTMLElement>('.attendance-list');
    const presentCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-present-count');
    const absentCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-absent-count');
    const totalCountEl = this.overlayEl.querySelector<HTMLElement>('.stat-total-count');

    if (!listEl) return;

    if (!this.activeGroup || this.activeGroup.students.length === 0) {
      listEl.innerHTML = `
        <div class="attendance-empty" style="text-align: center; padding: 24px 16px; color: #9aa0a6;">
          <p>У цій групі ще немає учнів або група не вибрана.</p>
          <p style="font-size: 11px; opacity: 0.7; margin-top: 6px;">
            Перейдіть на сторінку групи в LMS та натисніть «📥 Імпортувати в MeetSwitcher».
          </p>
        </div>
      `;
      if (presentCountEl) presentCountEl.textContent = '0';
      if (absentCountEl) absentCountEl.textContent = '0';
      if (totalCountEl) totalCountEl.textContent = '0';
      return;
    }

    const items = this.tracker.computeAttendance(this.activeGroup, this.currentActiveNames);
    const presentCount = items.filter((i) => i.isPresent).length;
    const absentCount = items.length - presentCount;

    if (presentCountEl) presentCountEl.textContent = String(presentCount);
    if (absentCountEl) absentCountEl.textContent = String(absentCount);
    if (totalCountEl) totalCountEl.textContent = String(items.length);

    listEl.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `attendance-row ${item.isPresent ? 'is-present' : 'is-absent'}`;

      row.innerHTML = `
        <button class="status-toggle-btn ${item.isPresent ? 'status-plus' : 'status-minus'}" title="Клікніть для зміни статусу (+ / -)">
          ${item.isPresent ? '+' : '−'}
        </button>
        <div class="student-info">
          <div class="student-name-row">
            <span class="student-fullname">${item.student.fullName}</span>
            <a href="${item.student.lmsUrl}" target="_blank" class="student-lms-link" title="Відкрити картку в LMS">↗</a>
          </div>
          <div class="student-meet-meta">
            ${
              item.student.meetOriginalName
                ? `<span class="paired-acc" title="Прив'язаний Google-акаунт">👤 ${item.student.meetOriginalName}</span>`
                : `<span class="unpaired-acc">⚠️ не прив'язано</span>`
            }
            ${item.isManualOverride ? '<span class="manual-tag">ручне</span>' : ''}
          </div>
        </div>
      `;

      const toggleBtn = row.querySelector<HTMLButtonElement>('.status-toggle-btn');
      toggleBtn?.addEventListener('click', () => {
        this.tracker.setManualOverride(item.student.id, !item.isPresent);
        this.render();
      });

      listEl.appendChild(row);
    }
  }

  private async copyReport(): Promise<void> {
    if (!this.activeGroup) return;

    const items = this.tracker.computeAttendance(this.activeGroup, this.currentActiveNames);
    const text = this.tracker.formatManagerReport(this.activeGroup, items);

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      const copyBtn = this.overlayEl?.querySelector<HTMLButtonElement>('.attendance-copy-btn');
      if (copyBtn) {
        const orig = copyBtn.innerHTML;
        copyBtn.innerHTML = '✅ Скопійовано для менеджера!';
        copyBtn.style.background = '#28a745';
        setTimeout(() => {
          copyBtn.innerHTML = orig;
          copyBtn.style.background = '';
        }, 2000);
      }
    } catch (err) {
      console.error('[MeetSwitcher:AttendanceModal] Failed to copy to clipboard:', err);
    }
  }
}
