import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLmsGroupPage } from '../src/lms/parser.ts';
import { extractFirstName } from '../src/types/attendance.ts';

test('parseLmsGroupPage extracts group name, id, and students from user DOM snippet', () => {
  // Simulating user snippet:
  // <div id="group-view" data-id="2595601">
  //   <div class="EditableArea GroupCard__header__title">
  //     <div class="EditableArea__input">УКР_Гейм_ЧТ_19:00</div>
  //   </div>
  //   <div id="group-student-grid">
  //     <div class="GroupStudent__list">
  //       <span class="permission-link GroupStudent__item__name">
  //         <a href="/student/update/6753930" target="_blank">Альфелді Камалія</a>
  //       </span>
  //       <span class="permission-link GroupStudent__item__name">
  //         <a href="/student/update/6753283" target="_blank">Воронченко Віра</a>
  //       </span>
  //     </div>
  //   </div>
  // </div>

  const links = [
    {
      getAttribute: (k: string) => (k === 'href' ? '/student/update/6753930' : null),
      textContent: ' Альфелді Камалія ',
    },
    {
      getAttribute: (k: string) => (k === 'href' ? 'https://lms.alg.academy/student/update/6753283' : null),
      textContent: 'Воронченко Віра',
    },
  ];

  const titleEl = { textContent: '  УКР_Гейм_ЧТ_19:00  ' };
  const rootEl = {
    getAttribute: (k: string) => (k === 'data-id' ? '2595601' : null),
  };

  const mockDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('EditableArea__input') || sel.includes('GroupCard__header__title')) {
        return titleEl;
      }
      if (sel.includes('#group-view')) {
        return rootEl;
      }
      return null;
    },
    querySelectorAll: (sel: string) => {
      if (sel.includes('/student/update/')) {
        return links;
      }
      return [];
    },
  } as any;

  const group = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/group/view/2595601#group-student-grid');

  assert.ok(group);
  assert.equal(group.id, '2595601');
  assert.equal(group.name, 'УКР_Гейм_ЧТ_19:00');
  assert.equal(group.students.length, 2);
  assert.equal(group.students[0].id, '6753930');
  assert.equal(group.students[0].fullName, 'Альфелді Камалія');
  assert.equal(group.students[0].shortAlias, 'Камалія');
  assert.equal(group.students[0].lmsUrl, 'https://lms.alg.academy/student/update/6753930');
  assert.equal(group.students[1].id, '6753283');
  assert.equal(group.students[1].fullName, 'Воронченко Віра');
  assert.equal(group.students[1].shortAlias, 'Віра');
});

test('parseLmsGroupPage handles missing elements gracefully', () => {
  const mockDoc = {
    querySelector: () => null,
    querySelectorAll: () => [],
  } as any;

  const result = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/other/page');
  assert.equal(result, null);
});

test('parseLmsGroupPage filters out inactive students (with is-inactive class or non-enrolled status)', () => {
  const activeStudentRow = {
    classList: { contains: (c: string) => c === 'GroupStudent__item' },
    querySelector: (sel: string) => {
      if (sel.includes('status')) {
        return {
          textContent: 'зарахований 01.09.2026',
          classList: { contains: () => false },
          closest: () => null,
        };
      }
      return null;
    },
    closest: () => null,
  };

  const inactiveStudentRow = {
    classList: { contains: (c: string) => c === 'GroupStudent__item' || c === 'is-inactive' },
    querySelector: (sel: string) => {
      if (sel.includes('status')) {
        return {
          textContent: 'відрахований 10.09.2026',
          classList: { contains: (c: string) => c === 'is-inactive' },
          closest: () => null,
        };
      }
      return null;
    },
    closest: () => null,
  };

  const activeLink = {
    getAttribute: (k: string) => (k === 'href' ? '/student/update/1111111' : null),
    textContent: 'Учень Активний',
    closest: (sel: string) => (sel.includes('is-inactive') ? null : activeStudentRow),
    parentElement: activeStudentRow,
  };

  const inactiveLink = {
    getAttribute: (k: string) => (k === 'href' ? '/student/update/2222222' : null),
    textContent: 'Учень Відрахований',
    closest: (sel: string) => (sel.includes('is-inactive') ? inactiveStudentRow : inactiveStudentRow),
    parentElement: inactiveStudentRow,
  };

  const mockDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('GroupCard__header__title')) return { textContent: 'Тестова Група' };
      if (sel.includes('#group-view')) return { getAttribute: () => '12345' };
      return null;
    },
    querySelectorAll: () => [activeLink, inactiveLink],
  } as any;

  const group = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/group/view/12345#group-student-grid');
  assert.ok(group);
  assert.equal(group.students.length, 1);
  assert.equal(group.students[0].id, '1111111');
  assert.equal(group.students[0].fullName, 'Учень Активний');
});

test('parseLmsGroupPage filters out transferred student matching exact user snippet', () => {
  // Simulating user snippet:
  // <div class="Expandable GroupStudent__item is-inactive">
  //   <div class="Expandable__header">
  //     <div class="GroupStudent__row">
  //       <div class="GroupStudent__col GroupStudent__col__badge">
  //         <div class="clearfix">
  //           <span class="permission-link GroupStudent__item__name">
  //             <a href="/student/update/6760652">Мисюк Павло</a>
  //           </span>
  //         </div>
  //       </div>
  //       <div class="GroupStudent__col GroupStudent__col__status">
  //         <button class="el-button el-button--warning"><b>перекладений 15.09.2026</b></button>
  //       </div>
  //     </div>
  //   </div>
  // </div>

  const transferredItem = {
    className: 'Expandable GroupStudent__item is-inactive',
    classList: {
      contains: (c: string) => ['Expandable', 'GroupStudent__item', 'is-inactive'].includes(c),
    },
  };

  const transferredHeader = {
    parentElement: transferredItem,
    className: 'Expandable__header',
    classList: { contains: () => false },
  };

  const transferredStatusContainer = {
    className: 'GroupStudent__col GroupStudent__col__status',
    classList: { contains: () => false },
    textContent: 'перекладений 15.09.2026 відновити',
    querySelector: (sel: string) => (sel.includes('warning') ? { className: 'el-button--warning' } : null),
  };

  const transferredRow = {
    parentElement: transferredHeader,
    className: 'GroupStudent__row',
    classList: { contains: () => false },
    querySelector: (sel: string) => (sel.includes('status') ? transferredStatusContainer : null),
  };

  const transferredBadge = {
    parentElement: transferredRow,
    className: 'GroupStudent__col GroupStudent__col__badge',
    classList: { contains: () => false },
  };

  const transferredLink = {
    getAttribute: (k: string) => (k === 'href' ? '/student/update/6760652' : null),
    textContent: 'Мисюк Павло',
    parentElement: transferredBadge,
    closest: (sel: string) => {
      if (sel.includes('is-inactive')) return transferredItem;
      if (sel.includes('GroupStudent__row')) return transferredRow;
      if (sel.includes('GroupStudent__item')) return transferredItem;
      return null;
    },
  };

  const activeItem = {
    className: 'Expandable GroupStudent__item',
    classList: {
      contains: (c: string) => ['Expandable', 'GroupStudent__item'].includes(c),
    },
  };

  const activeStatusContainer = {
    className: 'GroupStudent__col GroupStudent__col__status',
    classList: { contains: () => false },
    textContent: 'зарахований 01.09.2026',
    querySelector: () => null,
  };

  const activeRow = {
    parentElement: activeItem,
    className: 'GroupStudent__row',
    classList: { contains: () => false },
    querySelector: (sel: string) => (sel.includes('status') ? activeStatusContainer : null),
  };

  const activeLink = {
    getAttribute: (k: string) => (k === 'href' ? '/student/update/9999999' : null),
    textContent: 'Активний Учень',
    parentElement: activeRow,
    closest: (sel: string) => {
      if (sel.includes('is-inactive')) return null;
      if (sel.includes('GroupStudent__row')) return activeRow;
      if (sel.includes('GroupStudent__item')) return activeItem;
      return null;
    },
  };

  const gridEl = {
    querySelectorAll: () => [transferredLink, activeLink],
  };

  const mockDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('group-student-grid')) return gridEl;
      if (sel.includes('GroupCard__header__title')) return { textContent: 'УКР_Гейм' };
      if (sel.includes('group-view')) return { getAttribute: () => '2594219' };
      return null;
    },
  } as any;

  const group = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/group/view/2594219#group-student-grid');
  assert.ok(group);
  assert.equal(group.students.length, 1);
  assert.equal(group.students[0].id, '9999999');
  assert.equal(group.students[0].fullName, 'Активний Учень');
  assert.equal(group.students[0].shortAlias, 'Учень');
});

test('extractFirstName extracts second word as first name, handles single and multi-word names', () => {
  assert.equal(extractFirstName('Альфелді Камалія'), 'Камалія');
  assert.equal(extractFirstName('Мисюк Павло'), 'Павло');
  assert.equal(extractFirstName('Воронченко Віра'), 'Віра');
  assert.equal(extractFirstName('Петренко Олександр Іванович'), 'Олександр');
  assert.equal(extractFirstName('Максим'), 'Максим');
});

test('parseLmsGroupPage does not filter active students who have "Перекласти" or "Відрахувати" in dropdown action menu', () => {
  // Real LMS structure for active student:
  // Status column contains button with "зарахований {date}" AND dropdown menu with "Перекласти" / "Відрахувати"
  const successBtn = {
    className: 'el-button el-button--success el-button--micro',
    classList: { contains: (c: string) => c === 'el-button' || c === 'el-button--success' },
    textContent: 'зарахований 01.09.2026',
  };

  const statusCol = {
    className: 'GroupStudent__col GroupStudent__col__status',
    classList: { contains: () => false },
    textContent: 'зарахований 01.09.2026 Перекласти Відрахувати',
    querySelector: (sel: string) => {
      if (sel.includes('.el-button-group') || sel.includes('button')) return successBtn;
      return null;
    },
  };

  const studentRow = {
    className: 'Expandable GroupStudent__item',
    classList: { contains: (c: string) => c === 'GroupStudent__item' },
    querySelector: (sel: string) => (sel.includes('status') ? statusCol : null),
  };

  const studentLink = {
    getAttribute: (k: string) => (k === 'href' ? '/student/update/6753930' : null),
    textContent: 'Альфелді Камалія',
    closest: (sel: string) => {
      if (sel.includes('is-inactive')) return null;
      if (sel.includes('GroupStudent__item')) return studentRow;
      return null;
    },
  };

  const gridEl = {
    querySelectorAll: () => [studentLink],
  };

  const mockDoc = {
    querySelector: (sel: string) => {
      if (sel.includes('group-student-grid')) return gridEl;
      if (sel.includes('GroupCard__header__title')) return { textContent: 'УКР_Гейм_ЧТ_19:00' };
      if (sel.includes('group-view')) return { getAttribute: () => '2595601' };
      return null;
    },
  } as any;

  const group = parseLmsGroupPage(mockDoc, 'https://lms.alg.academy/group/view/2595601#group-student-grid');
  assert.ok(group);
  assert.equal(group.students.length, 1);
  assert.equal(group.students[0].id, '6753930');
  assert.equal(group.students[0].fullName, 'Альфелді Камалія');
  assert.equal(group.students[0].shortAlias, 'Камалія');
});


