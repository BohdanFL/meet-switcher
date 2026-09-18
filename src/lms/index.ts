import { parseLmsGroupPage } from './parser.ts';
import { GroupStore } from '../content/attendance/group-store.ts';

const store = GroupStore.getInstance();

function injectImportButton(): void {
  // Check if button already injected
  if (document.getElementById('meet-switcher-lms-btn')) {
    return;
  }

  // Target container from user DOM snippet
  const container = document.querySelector(
    '#group-student-grid .panel-heading .group-students .col-sm-12, #group-student-grid .panel-heading, #group-student-grid'
  );

  if (!container) {
    return;
  }

  const btn = document.createElement('button');
  btn.id = 'meet-switcher-lms-btn';
  btn.type = 'button';
  btn.className = 'btn btn-success group-students__btn meet-switcher-import-btn';
  btn.style.marginLeft = '8px';
  btn.style.fontWeight = '600';
  btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
  btn.innerHTML = '📥 Імпортувати в MeetSwitcher';

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '⏳ Імпортуємо...';

    try {
      const group = parseLmsGroupPage(document, window.location.href);
      if (!group || group.students.length === 0) {
        alert('Не вдалося знайти таблицю учнів (#group-student-grid). Перевірте, чи відкрита вкладка списку учнів.');
        btn.disabled = false;
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
        return;
      }

      await store.saveGroup(group);

      btn.style.background = '#28a745';
      btn.innerHTML = `✅ Імпортовано ${group.students.length} учнів!`;
      setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
      }, 3500);
    } catch (err) {
      console.error('[MeetSwitcher:LMS] Import failed:', err);
      btn.disabled = false;
      btn.innerHTML = '❌ Помилка імпорту';
      setTimeout(() => {
        btn.innerHTML = '📥 Імпортувати в MeetSwitcher';
      }, 3000);
    }
  });

  container.appendChild(btn);
}

// Observe DOM mutations to inject button when tabs change
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    injectImportButton();
  });
} else {
  injectImportButton();
}

const observer = new MutationObserver(() => {
  injectImportButton();
});
observer.observe(document.body, { childList: true, subtree: true });
