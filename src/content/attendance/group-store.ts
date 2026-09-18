import {
  type StudentGroup,
  type StudentGroupMap,
  STORAGE_KEY_LMS_GROUPS,
} from '../../types/attendance.ts';
import {
  STORAGE_KEY_GROUPS,
  STORAGE_KEY_ALIASES,
  type StudentAliasMap,
} from '../../types/alias.ts';

export interface GroupStoreOptions {
  enableStorageSync?: boolean;
}

export class GroupStore {
  private static instance: GroupStore | null = null;
  private groups: StudentGroupMap = {};
  private enableStorageSync: boolean;
  private isLoaded = false;
  private listeners: Array<(groups: StudentGroupMap) => void> = [];

  constructor(options: GroupStoreOptions = {}) {
    this.enableStorageSync = options.enableStorageSync ?? true;
  }

  public static getInstance(): GroupStore {
    if (!GroupStore.instance) {
      GroupStore.instance = new GroupStore();
    }
    return GroupStore.instance;
  }

  public async init(): Promise<void> {
    if (!this.enableStorageSync || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      this.isLoaded = true;
      return;
    }

    try {
      const res = await chrome.storage.sync.get(STORAGE_KEY_LMS_GROUPS);
      if (res && res[STORAGE_KEY_LMS_GROUPS]) {
        this.groups = res[STORAGE_KEY_LMS_GROUPS];
      }
    } catch (err) {
      console.warn('[MeetSwitcher:GroupStore] Error loading groups from sync, trying local:', err);
      try {
        const localRes = await chrome.storage?.local?.get(STORAGE_KEY_LMS_GROUPS);
        if (localRes && localRes[STORAGE_KEY_LMS_GROUPS]) {
          this.groups = localRes[STORAGE_KEY_LMS_GROUPS];
        }
      } catch (localErr) {
        console.warn('[MeetSwitcher:GroupStore] Local storage fallback failed:', localErr);
      }
    }
    this.isLoaded = true;
  }

  public async getAllGroups(): Promise<StudentGroupMap> {
    if (!this.isLoaded) {
      await this.init();
    }
    return { ...this.groups };
  }

  public async getGroup(id: string): Promise<StudentGroup | null> {
    if (!this.isLoaded) {
      await this.init();
    }
    return this.groups[id] ? JSON.parse(JSON.stringify(this.groups[id])) : null;
  }

  public async saveGroup(group: StudentGroup): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const existing = this.groups[group.id];
    let mergedStudents = group.students;

    if (existing && existing.students) {
      const existingMap = new Map(existing.students.map((s) => [s.id, s]));
      mergedStudents = group.students.map((newStudent) => {
        const oldStudent = existingMap.get(newStudent.id);
        if (oldStudent) {
          return {
            ...newStudent,
            meetOriginalName: newStudent.meetOriginalName || oldStudent.meetOriginalName,
            shortAlias: newStudent.shortAlias || oldStudent.shortAlias,
          };
        }
        return newStudent;
      });
    }

    this.groups[group.id] = {
      ...group,
      students: mergedStudents,
      updatedAt: Date.now(),
    };

    await this.persist();
    await this.syncToAliasesAndGroups(this.groups[group.id]);
    this.notifyListeners();
  }

  public async deleteGroup(id: string): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }
    delete this.groups[id];
    await this.persist();
    this.notifyListeners();
  }

  public async findGroupByTitle(callTitle: string): Promise<StudentGroup | null> {
    if (!callTitle || !callTitle.trim()) return null;
    if (!this.isLoaded) {
      await this.init();
    }

    const cleanTitle = callTitle.trim().toLowerCase();
    const groupList = Object.values(this.groups);

    // 1. Exact name match (case-insensitive)
    for (const group of groupList) {
      if (group.name.trim().toLowerCase() === cleanTitle) {
        return group;
      }
    }

    // 2. Substring match or Group ID match in call title
    for (const group of groupList) {
      const groupName = group.name.trim().toLowerCase();
      if (cleanTitle.includes(groupName) || groupName.includes(cleanTitle)) {
        return group;
      }
      if (cleanTitle.includes(group.id)) {
        return group;
      }
    }

    return null;
  }

  public async pairStudent(
    groupId: string,
    studentId: string,
    meetOriginalName: string,
    shortAlias?: string
  ): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const group = this.groups[groupId];
    if (!group) return;

    const student = group.students.find((s) => s.id === studentId);
    if (!student) return;

    student.meetOriginalName = meetOriginalName;
    if (shortAlias) {
      student.shortAlias = shortAlias;
    }
    group.updatedAt = Date.now();

    await this.persist();
    await this.syncToAliasesAndGroups(group);
    this.notifyListeners();
  }

  public async unpairStudent(groupId: string, studentId: string): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const group = this.groups[groupId];
    if (!group) return;

    const student = group.students.find((s) => s.id === studentId);
    if (!student) return;

    delete student.meetOriginalName;
    delete student.shortAlias;
    group.updatedAt = Date.now();

    await this.persist();
    this.notifyListeners();
  }

  public async removeStudent(groupId: string, studentId: string): Promise<void> {
    if (!this.isLoaded) {
      await this.init();
    }

    const group = this.groups[groupId];
    if (!group) return;

    const prevLen = group.students.length;
    group.students = group.students.filter((s) => s.id !== studentId);
    if (group.students.length !== prevLen) {
      group.updatedAt = Date.now();
      await this.persist();
      this.notifyListeners();
    }
  }

  public onUpdate(listener: (groups: StudentGroupMap) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(): void {
    const copy = { ...this.groups };
    for (const l of this.listeners) {
      try {
        l(copy);
      } catch (err) {
        console.error('[MeetSwitcher:GroupStore] Listener error:', err);
      }
    }
  }

  private async persist(): Promise<void> {
    if (!this.enableStorageSync || typeof chrome === 'undefined' || !chrome.storage?.sync) {
      return;
    }

    try {
      await chrome.storage.sync.set({ [STORAGE_KEY_LMS_GROUPS]: this.groups });
    } catch (err) {
      console.warn('[MeetSwitcher:GroupStore] Failed saving to sync, trying local fallback:', err);
      try {
        await chrome.storage?.local?.set({ [STORAGE_KEY_LMS_GROUPS]: this.groups });
      } catch (localErr) {
        console.error('[MeetSwitcher:GroupStore] Storage save failed completely:', localErr);
      }
    }
  }

  private async syncToAliasesAndGroups(group: StudentGroup): Promise<void> {
    if (!this.enableStorageSync || typeof chrome === 'undefined') return;

    try {
      const storage = chrome.storage?.sync || chrome.storage?.local;
      if (!storage) return;

      // 1. Update group list
      const groupsRes = await storage.get(STORAGE_KEY_GROUPS);
      const currentGroups: string[] = Array.isArray(groupsRes?.[STORAGE_KEY_GROUPS])
        ? groupsRes[STORAGE_KEY_GROUPS]
        : [];
      if (!currentGroups.includes(group.name)) {
        currentGroups.push(group.name);
        currentGroups.sort((a: string, b: string) => a.localeCompare(b, 'uk'));
        await storage.set({ [STORAGE_KEY_GROUPS]: currentGroups });
      }

      // 2. Update aliases map
      const aliasesRes = await storage.get(STORAGE_KEY_ALIASES);
      const currentAliases: StudentAliasMap = (aliasesRes?.[STORAGE_KEY_ALIASES] as StudentAliasMap) || {};

      let changed = false;
      for (const s of group.students) {
        const origName = (s.meetOriginalName || s.fullName).trim();
        const key = origName.toLowerCase();
        const studentAlias = s.shortAlias || s.fullName.split(' ')[0] || s.fullName;

        if (!currentAliases[key]) {
          currentAliases[key] = {
            key,
            originalName: origName,
            alias: studentAlias,
            group: group.name,
            updatedAt: Date.now(),
          };
          changed = true;
        } else if (currentAliases[key].group !== group.name) {
          currentAliases[key].group = group.name;
          currentAliases[key].updatedAt = Date.now();
          changed = true;
        }
      }

      if (changed) {
        await storage.set({ [STORAGE_KEY_ALIASES]: currentAliases });
      }
    } catch (err) {
      console.warn('[MeetSwitcher:GroupStore] Error syncing to aliases/groups:', err);
    }
  }
}
