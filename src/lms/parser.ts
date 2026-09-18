import type { StudentGroup, GroupStudent } from '../types/attendance.ts';

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
    // 1. Direct closest checks on link
    if (
      link.closest?.('.is-inactive, [class*="inactive"]') ||
      Boolean(link.closest?.('.is-inactive'))
    ) {
      continue;
    }

    // 2. Full ancestor traversal checking any element containing 'inactive' class
    let isInactive = false;
    let curr: Element | null = link.parentElement;
    while (curr) {
      const cls = curr.className;
      if (
        curr.classList?.contains('is-inactive') ||
        (typeof cls === 'string' && cls.includes('is-inactive'))
      ) {
        isInactive = true;
        break;
      }
      if (curr.id === 'group-student-grid' || curr.id === 'group-view') {
        break;
      }
      curr = curr.parentElement;
    }
    if (isInactive) {
      continue;
    }

    // 3. Check row container and status column
    const row =
      link.closest?.('.GroupStudent__item, .Expandable, .GroupStudent__row, tr') ||
      link.parentElement;

    if (row) {
      const rowCls = row.className;
      if (
        row.classList?.contains('is-inactive') ||
        (typeof rowCls === 'string' && rowCls.includes('is-inactive'))
      ) {
        continue;
      }

      // Check status element inside row or surrounding item
      const statusEl =
        row.querySelector?.('.GroupStudent__col__status, .GroupStudent__status, .student-status') ||
        row.parentElement?.querySelector?.('.GroupStudent__col__status, .GroupStudent__status, .student-status');

      if (statusEl) {
        const statusCls = statusEl.className;
        if (
          statusEl.classList?.contains('is-inactive') ||
          (typeof statusCls === 'string' && statusCls.includes('is-inactive')) ||
          Boolean(statusEl.closest?.('.is-inactive'))
        ) {
          continue;
        }

        // Element-UI warning / danger button check (transferred, expelled, etc.)
        if (statusEl.querySelector?.('.el-button--warning, .el-button--danger, .el-button--info')) {
          continue;
        }

        const statusText = statusEl.textContent?.trim().toLowerCase() || '';
        if (statusText) {
          // Must contain 'зарах' (e.g. 'зарахований')
          // Non-active keywords: 'перекладен' (transferred), 'відрах' (expelled), 'неактивн', 'заморожен'
          if (
            !statusText.includes('зарах') ||
            statusText.includes('перекладен') ||
            statusText.includes('відрах') ||
            statusText.includes('неактивн') ||
            statusText.includes('заморожен')
          ) {
            continue;
          }
        }
      }
    }

    seenIds.add(studentId);

    const fullName = link.textContent?.trim() || `Учень ${studentId}`;
    const lmsUrl = href.startsWith('http')
      ? href
      : `https://lms.alg.academy/student/update/${studentId}`;

    students.push({
      id: studentId,
      fullName,
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
