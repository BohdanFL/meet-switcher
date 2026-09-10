import { HudState } from '../../types';

const STORAGE_KEY = 'meetswitcher_hud_pos';

export class DraggableHud {
  private host: HTMLElement;
  private handle: HTMLElement;
  private state: HudState = {
    x: Math.max(20, window.innerWidth - 300),
    y: 80,
    collapsed: false,
  };

  private isDragging = false;
  private startX = 0;
  private startY = 0;
  private initialX = 0;
  private initialY = 0;

  private onMouseMoveHandler: (e: MouseEvent) => void;
  private onMouseUpHandler: () => void;

  constructor(host: HTMLElement, handle: HTMLElement) {
    this.host = host;
    this.handle = handle;

    this.onMouseMoveHandler = this.onMouseMove.bind(this);
    this.onMouseUpHandler = this.onMouseUp.bind(this);

    this.loadState();
    this.applyPosition();
    this.bindEvents();
  }

  public getState(): HudState {
    return this.state;
  }

  public setCollapsed(collapsed: boolean): void {
    this.state.collapsed = collapsed;
    this.saveState();
  }

  private bindEvents(): void {
    this.handle.addEventListener('mousedown', this.onMouseDown.bind(this));

    window.addEventListener('resize', () => {
      this.clampPosition();
      this.applyPosition();
    });
  }

  private onMouseDown(e: MouseEvent): void {
    // Only drag with left click and avoid clicking header buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.icon-btn, .btn-demo-pill, button')) return;

    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.initialX = this.state.x;
    this.initialY = this.state.y;

    window.addEventListener('mousemove', this.onMouseMoveHandler);
    window.addEventListener('mouseup', this.onMouseUpHandler);

    e.preventDefault();
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;

    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;

    this.state.x = this.initialX + deltaX;
    this.state.y = this.initialY + deltaY;

    this.clampPosition();
    this.applyPosition();
  }

  private onMouseUp(): void {
    if (!this.isDragging) return;
    this.isDragging = false;

    window.removeEventListener('mousemove', this.onMouseMoveHandler);
    window.removeEventListener('mouseup', this.onMouseUpHandler);

    this.saveState();
  }

  private clampPosition(): void {
    const hostWidth = this.host.offsetWidth || 340;
    const hostHeight = this.host.offsetHeight || 100;

    const maxX = Math.max(0, window.innerWidth - hostWidth - 10);
    const maxY = Math.max(0, window.innerHeight - hostHeight - 10);

    this.state.x = Math.max(10, Math.min(this.state.x, maxX));
    this.state.y = Math.max(10, Math.min(this.state.y, maxY));
  }

  private applyPosition(): void {
    this.host.style.left = `${this.state.x}px`;
    this.host.style.top = `${this.state.y}px`;
  }

  private loadState(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          this.state.x = parsed.x;
          this.state.y = parsed.y;
        }
        if (typeof parsed.collapsed === 'boolean') {
          this.state.collapsed = parsed.collapsed;
        }
      }
      this.clampPosition();
    } catch {
      // Use defaults if storage unavailable
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore quota/access errors
    }
  }
}
