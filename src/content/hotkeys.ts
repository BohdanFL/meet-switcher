import { PinController } from './pin-controller';

export class HotkeyManager {
  private controller: PinController;
  private isListening = false;
  private keydownHandler: (e: KeyboardEvent) => void;

  private onToggleWallHandler?: () => void;
  private onCloseWallHandler?: () => void;
  private onToggleDemoHandler?: () => void;
  private onToggleTurboHandler?: () => void;

  constructor(controller: PinController) {
    this.controller = controller;
    this.keydownHandler = this.handleKeydown.bind(this);
  }

  public setOnToggleWall(handler: () => void): void {
    this.onToggleWallHandler = handler;
  }

  public setOnCloseWall(handler: () => void): void {
    this.onCloseWallHandler = handler;
  }

  public setOnToggleDemo(handler: () => void): void {
    this.onToggleDemoHandler = handler;
  }

  public setOnToggleTurbo(handler: () => void): void {
    this.onToggleTurboHandler = handler;
  }

  public start(): void {
    if (this.isListening) return;
    this.isListening = true;
    window.addEventListener('keydown', this.keydownHandler, true);
  }

  public stop(): void {
    if (!this.isListening) return;
    this.isListening = false;
    window.removeEventListener('keydown', this.keydownHandler, true);
  }

  private handleKeydown(e: KeyboardEvent): void {
    // 0. Escape key closes the Classroom Wall
    if (e.key === 'Escape' || e.code === 'Escape') {
      if (this.onCloseWallHandler) {
        this.onCloseWallHandler();
      }
      return;
    }

    // 1. Ignore hotkeys when typing in form controls or rich text fields
    if (this.isInputElement(e.target as HTMLElement)) {
      return;
    }

    // 2. We only care about Alt key combinations (without Ctrl/Meta to avoid conflict with browser shortcuts)
    if (!e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }

    // 3. Demo simulation toggle: Alt + Shift + D
    if (e.shiftKey && (e.code === 'KeyD' || e.key.toLowerCase() === 'd')) {
      e.preventDefault();
      e.stopPropagation();
      if (this.onToggleDemoHandler) {
        this.onToggleDemoHandler();
      }
      return;
    }

    // 4. Toggle Classroom Wall: Alt + W
    if (e.code === 'KeyW' || e.key.toLowerCase() === 'w') {
      e.preventDefault();
      e.stopPropagation();
      if (this.onToggleWallHandler) {
        this.onToggleWallHandler();
      }
      return;
    }

    // 5. Toggle Turbo Mode (Meet Animations Off): Alt + A
    if (e.code === 'KeyA' || e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      if (this.onToggleTurboHandler) {
        this.onToggleTurboHandler();
      }
      return;
    }

    // 6. Unpin shortcut: Alt + 0 OR Alt + U
    if (e.code === 'Digit0' || e.code === 'Numpad0' || e.key === '0' || e.code === 'KeyU') {
      e.preventDefault();
      e.stopPropagation();
      this.controller.unpin();
      return;
    }

    // 6. Direct number shortcuts: Alt + 1 ... Alt + 9
    const matchNumber = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
    if (matchNumber && matchNumber[1]) {
      const index = parseInt(matchNumber[1], 10);
      e.preventDefault();
      e.stopPropagation();
      this.controller.switchToIndex(index);
      return;
    }

    // Also support e.key fallback for standard numbers
    if (/^[1-9]$/.test(e.key)) {
      const index = parseInt(e.key, 10);
      e.preventDefault();
      e.stopPropagation();
      this.controller.switchToIndex(index);
      return;
    }

    // 7. Next screen: Alt + ArrowRight OR Alt + J
    if (e.code === 'ArrowRight' || e.code === 'KeyJ') {
      e.preventDefault();
      e.stopPropagation();
      this.controller.switchNext();
      return;
    }

    // 8. Previous screen: Alt + ArrowLeft OR Alt + K
    if (e.code === 'ArrowLeft' || e.code === 'KeyK') {
      e.preventDefault();
      e.stopPropagation();
      this.controller.switchPrevious();
      return;
    }
  }

  /**
   * Determine if the active target is an editable element (chat box, search, etc.).
   */
  private isInputElement(target: HTMLElement | null): boolean {
    if (!target) return false;

    const tagName = target.tagName.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return true;
    }

    if (target.isContentEditable) {
      return true;
    }

    if (target.getAttribute('role') === 'textbox' || target.getAttribute('role') === 'searchbox') {
      return true;
    }

    // Check if within an active contenteditable parent (like Meet's chat composer)
    return target.closest('[contenteditable="true"]') !== null;
  }
}
