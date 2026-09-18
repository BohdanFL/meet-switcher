import type { GroupStudent, StudentGroup } from '../../types/attendance.ts';

export interface AttendanceStatusItem {
  student: GroupStudent;
  isPresent: boolean;
  isManualOverride: boolean;
  matchedBy?: string;
}

export class AttendanceTracker {
  private manualOverrides: Map<string, boolean> = new Map();

  public setManualOverride(studentId: string, isPresent: boolean | null): void {
    if (isPresent === null) {
      this.manualOverrides.delete(studentId);
    } else {
      this.manualOverrides.set(studentId, isPresent);
    }
  }

  public clearOverrides(): void {
    this.manualOverrides.clear();
  }

  public computeAttendance(group: StudentGroup, activeNames: string[]): AttendanceStatusItem[] {
    const normalizedActive = new Set(
      activeNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
    );

    return group.students.map((student) => {
      // 1. Check manual override first
      if (this.manualOverrides.has(student.id)) {
        return {
          student,
          isPresent: this.manualOverrides.get(student.id)!,
          isManualOverride: true,
          matchedBy: 'manual',
        };
      }

      // 2. Automatic matching by meetOriginalName, shortAlias, or fullName
      let isPresent = false;
      let matchedBy: string | undefined;

      const candidates = [
        student.meetOriginalName,
        student.shortAlias,
        student.fullName,
      ].filter((c): c is string => Boolean(c && c.trim()));

      for (const candidate of candidates) {
        const clean = candidate.trim().toLowerCase();
        if (normalizedActive.has(clean)) {
          isPresent = true;
          matchedBy = candidate;
          break;
        }

        // Substring / word match for partial names (e.g. "Iryna Alfeldi" vs "Alfeldi")
        for (const active of normalizedActive) {
          if (active.includes(clean) || clean.includes(active)) {
            isPresent = true;
            matchedBy = candidate;
            break;
          }
        }
        if (isPresent) break;
      }

      return {
        student,
        isPresent,
        isManualOverride: false,
        matchedBy,
      };
    });
  }

  public formatManagerReport(group: StudentGroup, items: AttendanceStatusItem[]): string {
    // Sort items alphabetically by student full name
    const sorted = [...items].sort((a, b) =>
      a.student.fullName.localeCompare(b.student.fullName, 'uk')
    );

    return sorted
      .map((item) => {
        const name = item.student.fullName;
        const link = item.student.lmsUrl;
        const meetAcc = item.student.meetOriginalName || "не прив'язано";
        const sign = item.isPresent ? '+' : '-';
        return `${name} (${link}) (${meetAcc}) ${sign}`;
      })
      .join('\n');
  }
}
