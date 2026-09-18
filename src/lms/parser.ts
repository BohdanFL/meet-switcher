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

  // 3. Extract Students from #group-student-grid
  const studentLinks = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('#group-student-grid a[href*="/student/update/"], a[href*="/student/update/"]')
  );

  const seenIds = new Set<string>();
  const students: GroupStudent[] = [];

  for (const link of studentLinks) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/student\/update\/(\d+)/);
    if (!match) continue;

    const studentId = match[1];
    if (seenIds.has(studentId)) continue;

    // Filter out inactive students (with is-inactive class or non-enrolled status)
    const row = link.closest?.('.GroupStudent__item, .Expandable, tr, .GroupStudent__row') || link.parentElement;
    if (row) {
      // 1. Check if row or any wrapper has is-inactive
      if (
        row.classList?.contains('is-inactive') ||
        Boolean(link.closest?.('.is-inactive'))
      ) {
        continue;
      }

      // 2. Check status element inside row
      const statusEl = row.querySelector?.('.GroupStudent__col__status, .GroupStudent__status, .student-status');
      if (statusEl) {
        if (
          statusEl.classList?.contains('is-inactive') ||
          Boolean(statusEl.closest?.('.is-inactive'))
        ) {
          continue;
        }

        const statusText = statusEl.textContent?.trim().toLowerCase() || '';
        if (statusText) {
          // Must contain 'зарах' (e.g. 'зарахований') and must NOT contain 'відрах'
          if (!statusText.includes('зарах') || statusText.includes('відрах')) {
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
