/**
 * Data structures for student aliases / teacher reminder labels.
 */
export interface StudentAliasEntry {
  /** Normalized lowercase lookup key (e.g., "оксана петренко") */
  key: string;

  /** Original Google Meet display name as detected (e.g., "Оксана Петренко") */
  originalName: string;

  /** Custom student nickname assigned by teacher (e.g., "Максим") */
  alias: string;

  /** Optional group name assigned by teacher (e.g., "5-А клас", "Python Пн 17:00") */
  group?: string;

  /** Timestamp of when the alias was created or last updated */
  updatedAt: number;
}

export type StudentAliasMap = Record<string, StudentAliasEntry>;

export const STORAGE_KEY_GROUPS = 'meet_switcher_student_groups';
