/**
 * Data structures for Algoritmika LMS student groups and attendance.
 */
export interface GroupStudent {
  /** LMS Student ID (e.g. "6753930") */
  id: string;

  /** Full student name from LMS (e.g. "Альфелді Камалія") */
  fullName: string;

  /** Link to student LMS profile (e.g. "https://lms.alg.academy/student/update/6753930") */
  lmsUrl: string;

  /** Bound Google Meet participant display name (e.g. "Iryna Alfeldi") */
  meetOriginalName?: string;

  /** Optional short alias or preferred call name (e.g. "Камалія") */
  shortAlias?: string;
}

export interface StudentGroup {
  /** LMS Group ID from URL or page data (e.g. "2595601") */
  id: string;

  /** Group title from LMS header (e.g. "УКР_Гейм_ЧТ_19:00") */
  name: string;

  /** Page URL in LMS */
  lmsUrl: string;

  /** List of enrolled students */
  students: GroupStudent[];

  /** Timestamp of when the group was imported or updated */
  updatedAt: number;
}

export type StudentGroupMap = Record<string, StudentGroup>;

export const STORAGE_KEY_LMS_GROUPS = 'meet_switcher_lms_groups';

/**
 * In Ukrainian LMS, names are formatted as: [Прізвище] [Ім'я] (e.g. "Альфелді Камалія", "Мисюк Павло").
 * The 1st word is the surname (прізвище).
 * The 2nd word is the first name (ім'я).
 * This helper returns the student's first name (ім'я) for aliases and HUD display.
 */
export function extractFirstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts[1];
  }
  return parts[0] || fullName;
}

