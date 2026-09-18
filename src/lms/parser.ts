import { extractFirstName, type StudentGroup, type GroupStudent } from '../types/attendance.ts';

export function parseLmsGroupPage(doc: ParentNode, pageUrl: string): StudentGroup | null {
  // 1. Extract Group ID from URL or #group-view[data-id]
  let groupId: string | null = null;
  const urlMatch = pageUrl.match(/\/group\/view\/(\d+)/);
  if (urlMatch) {
    groupId = urlMatch[1];
  } else {
    const rootEl = doc.querySelector('#group-view');
    if (rootEl) {
      groupId = rootEl.getAttribute('data-id');
    }
  }

  if (!groupId) {
    return null;
  }

  // 2. Extract Group Name
  const titleEl = doc.querySelector(
    '.GroupCard__header__title .EditableArea__input, .GroupCard__header__title, #group-view h1, #group-view .page-title'
  );
  const groupName = titleEl?.textContent?.trim() || `Група ${groupId}`;

  // 3. Extract Students from #group-student-grid (scope to grid if present)
  const gridEl = doc.querySelector('#group-student-grid');
  const scopeEl = gridEl || doc;
  const studentLinks = Array.from(
    scopeEl.querySelectorAll<HTMLAnchorElement>('a[href*="/student/update/"]')
  );

  const seenIds = new Set<string>();
  const students: GroupStudent[] = [];

  for (const link of studentLinks) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/student\/update\/(\d+)/);
    if (!match) continue;

    const studentId = match[1];
    if (seenIds.has(studentId)) continue;

    // Filter out inactive / transferred / expelled students
    // 1. Direct is-inactive class on student item container or ancestors
    const item =
      link.closest?.('.GroupStudent__item, .Expandable, tr') ||
      link.closest?.('.GroupStudent__row') ||
      link.parentElement;

    if (
      link.closest?.('.is-inactive') ||
      item?.classList?.contains('is-inactive') ||
      item?.closest?.('.is-inactive')
    ) {
      continue;
    }

    // 2. Check status column if present
    const statusCol = item?.querySelector?.(
      '.GroupStudent__col__status, .GroupStudent__status, .student-status'
    );

    if (statusCol) {
      if (
        statusCol.classList?.contains('is-inactive') ||
        statusCol.closest?.('.is-inactive')
      ) {
        continue;
      }

      // Check the primary status button (inside .el-button-group or direct button)
      // IMPORTANT: Exclude .el-dropdown-menu and .el-dropdown__caret-button!
      // The dropdown menu contains ACTION buttons like "Перекласти" and "Відрахувати",
      // which must NEVER be mistaken for the student's current status.
      const statusBtn = statusCol.querySelector?.(
        '.el-button-group > .el-button:not(.el-dropdown__caret-button), button.el-button:not(.el-dropdown__caret-button)'
      );

      if (statusBtn) {
        const btnClass = statusBtn.className || '';
        // Element-UI status color: warning (transferred), danger (expelled), info (inactive/archived)
        if (
          statusBtn.classList?.contains('el-button--warning') ||
          statusBtn.classList?.contains('el-button--danger') ||
          statusBtn.classList?.contains('el-button--info') ||
          btnClass.includes('el-button--warning') ||
          btnClass.includes('el-button--danger') ||
          btnClass.includes('el-button--info')
        ) {
          continue;
        }

        const btnText = statusBtn.textContent?.trim().toLowerCase() || '';
        const isExplicitlyInactive =
          btnText.includes('перекладен') ||
          btnText.includes('переведен') ||
          btnText.includes('відрах') ||
          btnText.includes('отчисл') ||
          btnText.includes('неактивн') ||
          btnText.includes('заморожен') ||
          btnText.includes('архів') ||
          btnText.includes('архив') ||
          btnText.includes('відхилен') ||
          btnText.includes('пауз') ||
          btnText.includes('transfer') ||
          btnText.includes('expell') ||
          btnText.includes('inactive');

        if (isExplicitlyInactive) {
          continue;
        }
      } else {
        // Fallback: If no button found, check status column text EXCLUDING dropdown menu
        const dropdownMenu = statusCol.querySelector?.('.el-dropdown-menu');
        const statusText = (dropdownMenu
          ? Array.from(statusCol.childNodes || [])
              .filter((n: any) => n !== dropdownMenu && !n.classList?.contains('el-dropdown-menu'))
              .map((n: any) => n.textContent || '')
              .join(' ')
          : statusCol.textContent || ''
        ).trim().toLowerCase();

        if (statusText) {
          const isExplicitlyInactive =
            statusText.includes('перекладен') ||
            statusText.includes('переведен') ||
            statusText.includes('відрах') ||
            statusText.includes('отчисл') ||
            statusText.includes('неактивн') ||
            statusText.includes('заморожен') ||
            statusText.includes('transfer') ||
            statusText.includes('expell') ||
            statusText.includes('inactive');

          if (isExplicitlyInactive) {
            continue;
          }
        }
      }
    }

    seenIds.add(studentId);

    const fullName = (link.textContent || '').trim().replace(/\s+/g, ' ') || `Учень ${studentId}`;
    const shortAlias = extractFirstName(fullName);
    const lmsUrl = href.startsWith('http')
      ? href
      : `https://lms.alg.academy/student/update/${studentId}`;

    students.push({
      id: studentId,
      fullName,
      shortAlias,
      lmsUrl,
    });
  }

  if (students.length === 0 && !doc.querySelector('#group-student-grid')) {
    return null;
  }

  return {
    id: groupId,
    name: groupName,
    lmsUrl: pageUrl,
    students,
    updatedAt: Date.now(),
  };
}
