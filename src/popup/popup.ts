import type { SessionLog } from '../diagnostics/types.ts';

const STORAGE_KEY_SESSIONS = 'meet_switcher_diagnostic_sessions';

let cachedSessions: SessionLog[] = [];
let selectedSessionIndex = 0;

async function initPopup(): Promise<void> {
  const emptyStateEl = document.getElementById('empty-state')!;
  const sessionCardEl = document.getElementById('session-card')!;
  const pastSessionsSectionEl = document.getElementById('past-sessions-section')!;
  const selectorEl = document.getElementById('session-selector') as HTMLSelectElement;

  try {
    const data = await chrome.storage.local.get(STORAGE_KEY_SESSIONS);
    cachedSessions = Array.isArray(data[STORAGE_KEY_SESSIONS]) ? data[STORAGE_KEY_SESSIONS] : [];
  } catch (err) {
    console.error('Failed to read sessions from storage', err);
    cachedSessions = [];
  }

  // Wire Demo setting toggle
  const demoToggleEl = document.getElementById('toggle-demo-setting') as HTMLInputElement;
  if (demoToggleEl) {
    try {
      const demoData = await chrome.storage.local.get('meet_switcher_show_demo');
      demoToggleEl.checked = Boolean(demoData.meet_switcher_show_demo);
    } catch {
      demoToggleEl.checked = false;
    }

    demoToggleEl.addEventListener('change', async () => {
      await chrome.storage.local.set({ meet_switcher_show_demo: demoToggleEl.checked });
    });
  }

  if (cachedSessions.length === 0) {
    emptyStateEl.style.display = 'block';
    sessionCardEl.style.display = 'none';
    pastSessionsSectionEl.style.display = 'none';
    return;
  }

  emptyStateEl.style.display = 'none';
  sessionCardEl.style.display = 'flex';

  // Build select options
  selectorEl.innerHTML = '';
  cachedSessions.forEach((session, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    const date = new Date(session.startTime);
    const timeFormatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateFormatted = date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    opt.textContent = `${idx === 0 ? '⭐ Останній урок: ' : ''}${dateFormatted} ${timeFormatted} (${session.detectedParticipants.length} учнів)`;
    selectorEl.appendChild(opt);
  });

  if (cachedSessions.length > 1) {
    pastSessionsSectionEl.style.display = 'flex';
  } else {
    pastSessionsSectionEl.style.display = 'none';
  }

  selectorEl.addEventListener('change', () => {
    selectedSessionIndex = parseInt(selectorEl.value, 10);
    renderSession(cachedSessions[selectedSessionIndex]);
  });

  renderSession(cachedSessions[0]);

  // Wire Download button
  const downloadBtn = document.getElementById('btn-download')!;
  downloadBtn.addEventListener('click', () => {
    const session = cachedSessions[selectedSessionIndex];
    if (!session) return;
    downloadSessionJson(session);
  });

  // Wire Copy button
  const copyBtn = document.getElementById('btn-copy')!;
  const copyFeedback = document.getElementById('copy-feedback')!;
  copyBtn.addEventListener('click', async () => {
    const session = cachedSessions[selectedSessionIndex];
    if (!session) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(session, null, 2));
      copyFeedback.style.display = 'block';
      setTimeout(() => {
        copyFeedback.style.display = 'none';
      }, 2500);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  });

  // Wire Clear button
  const clearBtn = document.getElementById('btn-clear')!;
  clearBtn.addEventListener('click', async () => {
    if (confirm('Видалити всі збережені логи уроків?')) {
      await chrome.storage.local.remove(STORAGE_KEY_SESSIONS);
      cachedSessions = [];
      emptyStateEl.style.display = 'block';
      sessionCardEl.style.display = 'none';
      pastSessionsSectionEl.style.display = 'none';
    }
  });
}

function renderSession(session: SessionLog): void {
  const dateEl = document.getElementById('session-date')!;
  const durationEl = document.getElementById('session-duration')!;
  const screensEl = document.getElementById('session-screens')!;
  const switchesEl = document.getElementById('session-switches')!;
  const statusEl = document.getElementById('session-status')!;
  const participantsListEl = document.getElementById('participants-list')!;

  const date = new Date(session.startTime);
  dateEl.textContent = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const secs = session.durationSeconds || 0;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  durationEl.textContent = mins > 0 ? `${mins} хв ${remSecs} с` : `${remSecs} с`;

  screensEl.textContent = String(session.detectedParticipants.length);
  switchesEl.textContent = `${session.successfulSwitches} / ${session.totalSwitches}`;

  if (session.errorCount === 0) {
    statusEl.className = 'status-pill success';
    statusEl.textContent = '🟢 Успішно';
  } else {
    statusEl.className = 'status-pill error';
    statusEl.textContent = `🔴 ${session.errorCount} помилок`;
  }

  participantsListEl.innerHTML = '';
  if (session.detectedParticipants.length === 0) {
    participantsListEl.innerHTML = '<span style="color: #9aa0a6; font-size: 11px;">(Не зафіксовано)</span>';
  } else {
    session.detectedParticipants.forEach((name) => {
      const tag = document.createElement('span');
      tag.className = 'participant-tag';
      tag.textContent = name;
      participantsListEl.appendChild(tag);
    });
  }
}

function downloadSessionJson(session: SessionLog): void {
  const dateStr = new Date(session.startTime).toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  const filename = `meet-switcher-log-${dateStr}.json`;
  const jsonStr = JSON.stringify(session, null, 2);

  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
}

document.addEventListener('DOMContentLoaded', initPopup);
