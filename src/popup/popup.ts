import type { SessionLog } from '../diagnostics/types.ts';
import { STORAGE_KEY_GROUPS, type StudentAliasEntry, type StudentAliasMap } from '../types/alias.ts';

const STORAGE_KEY_SESSIONS = 'meet_switcher_diagnostic_sessions';
const STORAGE_KEY_ALIASES = 'meet_switcher_student_aliases';

let cachedSessions: SessionLog[] = [];
let selectedSessionIndex = 0;
let aliasesMap: StudentAliasMap = {};
let groupsList: string[] = [];
const collapsedGroups: Set<string> = new Set();

async function initPopup(): Promise<void> {
  initTabs();
  await initRoster();
  await initDiagnostics();
}

function initTabs(): void {
  const tabBtns = document.querySelectorAll<HTMLButtonElement>('.tab-btn');
  const tabPanes = document.querySelectorAll<HTMLElement>('.tab-pane');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      if (!targetId) return;

      tabBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) {
        targetPane.classList.add('active');
      }
    });
  });
}

/* =========================================================================
   ROSTER MANAGEMENT (STUDENT ALIASES & GROUPS)
   ========================================================================= */

function normalizeLookupKey(name: string): string {
  return name
    .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*)/i, '')
    .replace(/\s*\(презентація\)$/i, '')
    .replace(/\s*\(presentation\)$/i, '')
    .replace(/\s*\(презентация\)$/i, '')
    .replace(/'s presentation$/i, '')
    .trim()
    .toLowerCase();
}

async function getAliasesFromStorage(): Promise<StudentAliasMap> {
  return new Promise((resolve) => {
    const storage = chrome?.storage?.sync || chrome?.storage?.local;
    if (!storage) {
      resolve({});
      return;
    }

    storage.get(STORAGE_KEY_ALIASES, (res) => {
      if (chrome.runtime?.lastError) {
        chrome.storage?.local?.get(STORAGE_KEY_ALIASES, (localRes) => {
          resolve((localRes?.[STORAGE_KEY_ALIASES] as StudentAliasMap) || {});
        });
        return;
      }
      resolve((res?.[STORAGE_KEY_ALIASES] as StudentAliasMap) || {});
    });
  });
}

async function saveAliasesToStorage(data: StudentAliasMap): Promise<void> {
  return new Promise((resolve) => {
    const storage = chrome?.storage?.sync || chrome?.storage?.local;
    if (!storage) {
      resolve();
      return;
    }

    storage.set({ [STORAGE_KEY_ALIASES]: data }, () => {
      if (chrome.runtime?.lastError) {
        chrome.storage?.local?.set({ [STORAGE_KEY_ALIASES]: data }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

async function getGroupsFromStorage(): Promise<string[]> {
  return new Promise((resolve) => {
    const storage = chrome?.storage?.sync || chrome?.storage?.local;
    if (!storage) {
      resolve([]);
      return;
    }

    storage.get(STORAGE_KEY_GROUPS, (res) => {
      if (chrome.runtime?.lastError) {
        chrome.storage?.local?.get(STORAGE_KEY_GROUPS, (localRes) => {
          resolve((localRes?.[STORAGE_KEY_GROUPS] as string[]) || []);
        });
        return;
      }
      resolve((res?.[STORAGE_KEY_GROUPS] as string[]) || []);
    });
  });
}

async function saveGroupsToStorage(groups: string[]): Promise<void> {
  return new Promise((resolve) => {
    const storage = chrome?.storage?.sync || chrome?.storage?.local;
    if (!storage) {
      resolve();
      return;
    }

    storage.set({ [STORAGE_KEY_GROUPS]: groups }, () => {
      if (chrome.runtime?.lastError) {
        chrome.storage?.local?.set({ [STORAGE_KEY_GROUPS]: groups }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

function populateGroupSelect(selectedGroup?: string): void {
  const selectEl = document.getElementById('select-group') as HTMLSelectElement;
  if (!selectEl) return;
  const currentVal = selectedGroup !== undefined ? selectedGroup : selectEl.value;
  selectEl.innerHTML = '<option value="">📁 (Без групи)</option>';
  groupsList.forEach((group) => {
    const opt = document.createElement('option');
    opt.value = group;
    opt.textContent = `📁 ${group}`;
    if (group === currentVal) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

async function createGroup(name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;

  if (groupsList.some((g) => g.toLowerCase() === trimmed.toLowerCase())) {
    alert(`Група "${trimmed}" вже існує.`);
    return false;
  }

  groupsList.push(trimmed);
  groupsList.sort((a, b) => a.localeCompare(b, 'uk'));
  await saveGroupsToStorage(groupsList);
  populateGroupSelect(trimmed);
  const searchInput = document.getElementById('input-search-roster') as HTMLInputElement;
  renderRosterList(searchInput ? searchInput.value : '');
  return true;
}

async function renameGroup(oldName: string, newName: string): Promise<void> {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === oldName) return;

  if (
    groupsList.some(
      (g) => g.toLowerCase() === trimmed.toLowerCase() && g !== oldName
    )
  ) {
    alert(`Група з назвою "${trimmed}" вже існує.`);
    return;
  }

  const idx = groupsList.indexOf(oldName);
  if (idx !== -1) {
    groupsList[idx] = trimmed;
    groupsList.sort((a, b) => a.localeCompare(b, 'uk'));
    await saveGroupsToStorage(groupsList);
  }

  if (collapsedGroups.has(oldName)) {
    collapsedGroups.delete(oldName);
    collapsedGroups.add(trimmed);
  }

  let updatedAny = false;
  for (const item of Object.values(aliasesMap)) {
    if (item.group === oldName) {
      item.group = trimmed;
      item.updatedAt = Date.now();
      updatedAny = true;
    }
  }

  if (updatedAny) {
    await saveAliasesToStorage(aliasesMap);
  }

  populateGroupSelect();
  const searchInput = document.getElementById('input-search-roster') as HTMLInputElement;
  renderRosterList(searchInput ? searchInput.value : '');
}

async function deleteGroup(groupName: string): Promise<void> {
  if (
    !confirm(
      `Видалити групу "${groupName}"?\n\nУчні не будуть видалені — вони перейдуть у категорію "(Без групи)".`
    )
  ) {
    return;
  }

  groupsList = groupsList.filter((g) => g !== groupName);
  await saveGroupsToStorage(groupsList);
  collapsedGroups.delete(groupName);

  let updatedAny = false;
  for (const item of Object.values(aliasesMap)) {
    if (item.group === groupName) {
      delete item.group;
      item.updatedAt = Date.now();
      updatedAny = true;
    }
  }

  if (updatedAny) {
    await saveAliasesToStorage(aliasesMap);
  }

  populateGroupSelect();
  const searchInput = document.getElementById('input-search-roster') as HTMLInputElement;
  renderRosterList(searchInput ? searchInput.value : '');
}

async function initRoster(): Promise<void> {
  const origInput = document.getElementById('input-orig-name') as HTMLInputElement;
  const studentInput = document.getElementById('input-student-name') as HTMLInputElement;
  const groupSelect = document.getElementById('select-group') as HTMLSelectElement;
  const showAddGroupBtn = document.getElementById('btn-show-add-group') as HTMLButtonElement;
  const groupCreateInline = document.getElementById('group-create-inline') as HTMLElement;
  const newGroupNameInput = document.getElementById('input-new-group-name') as HTMLInputElement;
  const saveNewGroupBtn = document.getElementById('btn-save-new-group') as HTMLButtonElement;
  const cancelNewGroupBtn = document.getElementById('btn-cancel-new-group') as HTMLButtonElement;
  const saveBtn = document.getElementById('btn-save-alias') as HTMLButtonElement;
  const cancelBtn = document.getElementById('btn-cancel-alias') as HTMLButtonElement;
  const searchInput = document.getElementById('input-search-roster') as HTMLInputElement;
  const exportBtn = document.getElementById('btn-export-roster') as HTMLButtonElement;
  const importBtn = document.getElementById('btn-import-roster') as HTMLButtonElement;
  const fileInput = document.getElementById('import-file-input') as HTMLInputElement;

  aliasesMap = await getAliasesFromStorage();
  groupsList = await getGroupsFromStorage();

  let newGroupsFound = false;
  for (const item of Object.values(aliasesMap)) {
    if (item.group && !groupsList.includes(item.group)) {
      groupsList.push(item.group);
      newGroupsFound = true;
    }
  }
  if (newGroupsFound) {
    groupsList.sort((a, b) => a.localeCompare(b, 'uk'));
    await saveGroupsToStorage(groupsList);
  }

  populateGroupSelect();
  renderRosterList(searchInput.value);

  showAddGroupBtn.addEventListener('click', () => {
    groupCreateInline.style.display = 'flex';
    newGroupNameInput.value = '';
    newGroupNameInput.focus();
  });

  saveNewGroupBtn.addEventListener('click', async () => {
    const success = await createGroup(newGroupNameInput.value);
    if (success) {
      newGroupNameInput.value = '';
      groupCreateInline.style.display = 'none';
    }
  });

  newGroupNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveNewGroupBtn.click();
    } else if (e.key === 'Escape') {
      cancelNewGroupBtn.click();
    }
  });

  cancelNewGroupBtn.addEventListener('click', () => {
    newGroupNameInput.value = '';
    groupCreateInline.style.display = 'none';
  });

  // Search filter
  searchInput.addEventListener('input', () => {
    renderRosterList(searchInput.value);
  });

  // Save alias
  saveBtn.addEventListener('click', async () => {
    const orig = origInput.value.trim();
    const alias = studentInput.value.trim();
    const selectedGroup = groupSelect.value.trim();

    if (!orig || !alias) {
      alert("Будь ласка, введіть ім'я акаунта та справжнє ім'я учня.");
      return;
    }

    const key = normalizeLookupKey(orig);
    aliasesMap[key] = {
      key,
      originalName: orig,
      alias,
      group: selectedGroup || undefined,
      updatedAt: Date.now(),
    };

    await saveAliasesToStorage(aliasesMap);
    origInput.value = '';
    studentInput.value = '';
    groupSelect.value = '';
    cancelBtn.style.display = 'none';
    renderRosterList(searchInput.value);
  });

  // Cancel edit
  cancelBtn.addEventListener('click', () => {
    origInput.value = '';
    studentInput.value = '';
    groupSelect.value = '';
    cancelBtn.style.display = 'none';
  });

  // Export JSON
  exportBtn.addEventListener('click', () => {
    const entries = Object.values(aliasesMap);
    if (entries.length === 0) {
      alert('Немає збережених учнів для експорту.');
      return;
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `meet-switcher-students-${dateStr}.json`;
    const jsonStr = JSON.stringify(entries, null, 2);

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
  });

  // Import JSON
  importBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        if (!Array.isArray(parsed)) {
          alert('Помилка: файл повинен містити масив учнів.');
          return;
        }

        let importedCount = 0;
        let groupsAdded = 0;
        for (const item of parsed) {
          if (item && item.originalName && item.alias) {
            const key = normalizeLookupKey(item.originalName);
            const groupName = item.group ? item.group.trim() : undefined;
            aliasesMap[key] = {
              key,
              originalName: item.originalName.trim(),
              alias: item.alias.trim(),
              group: groupName,
              updatedAt: item.updatedAt || Date.now(),
            };
            if (groupName && !groupsList.includes(groupName)) {
              groupsList.push(groupName);
              groupsAdded++;
            }
            importedCount++;
          }
        }

        if (groupsAdded > 0) {
          groupsList.sort((a, b) => a.localeCompare(b, 'uk'));
          await saveGroupsToStorage(groupsList);
          populateGroupSelect();
        }

        await saveAliasesToStorage(aliasesMap);
        renderRosterList(searchInput.value);
        alert(`Успішно імпортовано учнів: ${importedCount}`);
      } catch (err) {
        console.error('Import error:', err);
        alert('Не вдалося імпортувати файл. Перевірте формат JSON.');
      }
    };
    reader.readAsText(file);
  });
}

function renderRosterList(filter = ''): void {
  const containerEl = document.getElementById('roster-groups-container')!;
  const emptyEl = document.getElementById('roster-empty')!;
  const origInput = document.getElementById('input-orig-name') as HTMLInputElement;
  const studentInput = document.getElementById('input-student-name') as HTMLInputElement;
  const groupSelect = document.getElementById('select-group') as HTMLSelectElement;
  const cancelBtn = document.getElementById('btn-cancel-alias') as HTMLButtonElement;

  const entries = Object.values(aliasesMap);
  const normalizedFilter = filter.trim().toLowerCase();
  const isFilterActive = Boolean(normalizedFilter);

  const UNASSIGNED_KEY = '';
  const groupedStudents = new Map<string, StudentAliasEntry[]>();

  for (const grp of groupsList) {
    groupedStudents.set(grp, []);
  }
  groupedStudents.set(UNASSIGNED_KEY, []);

  for (const student of entries) {
    const grp = student.group || UNASSIGNED_KEY;
    if (!groupedStudents.has(grp)) {
      groupedStudents.set(grp, []);
    }
    groupedStudents.get(grp)!.push(student);
  }

  containerEl.innerHTML = '';

  const displayGroups = [...groupsList];
  const unassignedList = groupedStudents.get(UNASSIGNED_KEY) || [];
  if (unassignedList.length > 0 || !isFilterActive) {
    displayGroups.push(UNASSIGNED_KEY);
  }

  let totalVisibleStudents = 0;
  let totalVisibleGroups = 0;

  displayGroups.forEach((grpName) => {
    const allInGroup = groupedStudents.get(grpName) || [];
    allInGroup.sort((a, b) => a.alias.localeCompare(b.alias, 'uk'));

    const groupMatchesQuery =
      isFilterActive && grpName && grpName.toLowerCase().includes(normalizedFilter);

    const matchingStudents = isFilterActive
      ? groupMatchesQuery
        ? allInGroup
        : allInGroup.filter(
            (item) =>
              item.alias.toLowerCase().includes(normalizedFilter) ||
              item.originalName.toLowerCase().includes(normalizedFilter)
          )
      : allInGroup;

    if (isFilterActive && matchingStudents.length === 0) {
      return;
    }

    totalVisibleGroups++;
    totalVisibleStudents += matchingStudents.length;

    const isUnassigned = grpName === UNASSIGNED_KEY;
    const displayName = isUnassigned ? '(Без групи)' : grpName;
    const isCollapsed = !isFilterActive && collapsedGroups.has(grpName);

    const groupCard = document.createElement('div');
    groupCard.className = `group-card${isCollapsed ? ' collapsed' : ''}`;

    const header = document.createElement('div');
    header.className = 'group-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'group-header-left';
    headerLeft.innerHTML = `
      <span class="group-header-title">📁 ${escapeHtml(displayName)}</span>
      <span class="group-badge-count">${matchingStudents.length} уч.</span>
    `;

    const headerActions = document.createElement('div');
    headerActions.className = 'group-header-actions';

    if (!isUnassigned) {
      const editGroupBtn = document.createElement('button');
      editGroupBtn.className = 'roster-icon-btn';
      editGroupBtn.title = 'Перейменувати групу';
      editGroupBtn.innerHTML = '✏️';
      editGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newName = prompt(`Введіть нову назву для групи "${grpName}":`, grpName);
        if (newName) {
          renameGroup(grpName, newName);
        }
      });
      headerActions.appendChild(editGroupBtn);

      const deleteGroupBtn = document.createElement('button');
      deleteGroupBtn.className = 'roster-icon-btn delete';
      deleteGroupBtn.title = 'Видалити групу';
      deleteGroupBtn.innerHTML = '🗑️';
      deleteGroupBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteGroup(grpName);
      });
      headerActions.appendChild(deleteGroupBtn);
    }

    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.textContent = '▼';
    headerActions.appendChild(chevron);

    header.appendChild(headerLeft);
    header.appendChild(headerActions);

    header.addEventListener('click', () => {
      if (groupCard.classList.contains('collapsed')) {
        groupCard.classList.remove('collapsed');
        collapsedGroups.delete(grpName);
      } else {
        groupCard.classList.add('collapsed');
        collapsedGroups.add(grpName);
      }
    });

    const body = document.createElement('div');
    body.className = 'group-body';

    if (matchingStudents.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'group-empty-hint';
      hint.textContent = 'У цій групі ще немає учнів';
      body.appendChild(hint);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'roster-items-list';

      matchingStudents.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'roster-item';

        li.innerHTML = `
          <div class="roster-item-text">
            <span class="roster-student-name">${escapeHtml(item.alias)}</span>
            <span class="roster-orig-name">Акаунт: ${escapeHtml(item.originalName)}</span>
          </div>
          <div class="roster-item-actions">
            <button class="roster-icon-btn edit" title="Редагувати">✏️</button>
            <button class="roster-icon-btn delete" title="Видалити псевдонім">🗑️</button>
          </div>
        `;

        const editBtn = li.querySelector<HTMLButtonElement>('.edit')!;
        const deleteBtn = li.querySelector<HTMLButtonElement>('.delete')!;

        editBtn.addEventListener('click', () => {
          origInput.value = item.originalName;
          studentInput.value = item.alias;
          groupSelect.value = item.group || '';
          cancelBtn.style.display = 'inline-flex';
          origInput.focus();
        });

        deleteBtn.addEventListener('click', async () => {
          if (confirm(`Видалити псевдонім "${item.alias}" для акаунта "${item.originalName}"?`)) {
            delete aliasesMap[item.key];
            await saveAliasesToStorage(aliasesMap);
            renderRosterList(filter);
          }
        });

        ul.appendChild(li);
      });

      body.appendChild(ul);
    }

    groupCard.appendChild(header);
    groupCard.appendChild(body);
    containerEl.appendChild(groupCard);
  });

  if (
    totalVisibleGroups === 0 &&
    totalVisibleStudents === 0 &&
    (entries.length === 0 || isFilterActive)
  ) {
    emptyEl.style.display = 'block';
  } else {
    emptyEl.style.display = 'none';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =========================================================================
   DIAGNOSTICS & SESSIONS
   ========================================================================= */

async function initDiagnostics(): Promise<void> {
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
