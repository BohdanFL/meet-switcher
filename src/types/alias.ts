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

  /** Timestamp of when the alias was created or last updated */
  updatedAt: number;
}

export type StudentAliasMap = Record<string, StudentAliasEntry>;
