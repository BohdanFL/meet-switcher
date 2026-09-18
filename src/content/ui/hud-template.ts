/**
 * HTML templates for SwitcherHud.
 * Separated to allow headless testing in Node.js without CSS loaders.
 */

export const HUD_ACTIONS_HTML = `
  <button class="icon-btn speed-btn active" title="Турбо-режим активний: анімації Google Meet вимкнено (Alt + A)">⚡</button>
  <button class="btn-demo-pill" style="display: none;" title="Тестовий демо-режим: 9 учнів (Alt + Shift + D)">🧪 Демо</button>
  <button class="icon-btn wall-btn" title="Стіна класу / Огляд (Alt + W)">⊞</button>
  <button class="icon-btn attendance-btn" title="Відвідуваність уроку">📋</button>
  <button class="icon-btn toggle-btn" title="Згорнути / Розгорнути">─</button>
`;

export function getHudSkeletonHtml(): string {
  return `
    <div class="hud-header">
      <div class="hud-title-wrap">
        <span class="drag-handle">⠿</span>
        <span class="hud-title">MeetSwitcher</span>
        <span class="hud-badge">0 екранів</span>
      </div>
      <div class="hud-actions">
        ${HUD_ACTIONS_HTML}
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
}
