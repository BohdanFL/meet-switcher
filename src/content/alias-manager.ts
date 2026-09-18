import type { StudentAliasEntry, StudentAliasMap } from '../types/alias.ts';

export interface AliasManagerOptions {
  enableStorageSync?: boolean;
}

export class AliasManager {
  private static instance: AliasManager | null = null;
  private cache: Map<string, StudentAliasEntry> = new Map();
  private listeners: Set<() => void> = new Set();
  private isInitialized = false;
  private storageKey = 'meet_switcher_student_aliases';
  private enableStorageSync = true;

  constructor(options?: AliasManagerOptions) {
    if (options?.enableStorageSync !== undefined) {
      this.enableStorageSync = options.enableStorageSync;
    }
    if (this.enableStorageSync) {
      this.listenToStorageChanges();
    }
  }

  public static getInstance(): AliasManager {
    if (!AliasManager.instance) {
      AliasManager.instance = new AliasManager();
    }
    return AliasManager.instance;
  }

  public normalizeName(name: string): string {
    if (!name) return '';
    return name
      .replace(/^(?:презентація\s*:\s*|presentation\s*:\s*|презентация\s*:\s*)/i, '')
      .replace(/\s*\(презентація\)$/i, '')
      .replace(/\s*\(presentation\)$/i, '')
      .replace(/\s*\(презентация\)$/i, '')
      .replace(/'s presentation$/i, '')
      .trim()
      .toLowerCase();
  }

  public async init(): Promise<void> {
    if (this.isInitialized || !this.enableStorageSync) {
      this.isInitialized = true;
      return;
    }

    try {
      const data = await this.readStorage();
      this.cache.clear();
      for (const [key, entry] of Object.entries(data)) {
        this.cache.set(key, entry);
      }
    } catch (err) {
      console.warn('[MeetSwitcher:AliasManager] Failed to load aliases from storage:', err);
    } finally {
      this.isInitialized = true;
      this.notifyListeners();
    }
  }

  public getAlias(originalName: string): string | null {
    const key = this.normalizeName(originalName);
    const entry = this.cache.get(key);
    return entry && entry.alias.trim() ? entry.alias.trim() : null;
  }

  public formatDisplayName(originalName: string): string {
    const alias = this.getAlias(originalName);
    if (alias) {
      return `${alias} (${originalName})`;
    }
    return originalName;
  }

  public getStudentGroup(originalName: string): string | null {
    const key = this.normalizeName(originalName);
    const entry = this.cache.get(key);
    return entry && entry.group ? entry.group : null;
  }

  public async setAlias(originalName: string, studentName: string, group?: string): Promise<void> {
    const trimmedAlias = studentName.trim();
    if (!trimmedAlias) {
      await this.removeAlias(originalName);
      return;
    }

    const key = this.normalizeName(originalName);
    const existing = this.cache.get(key);
    const resolvedGroup = group !== undefined ? (group.trim() || undefined) : existing?.group;

    const entry: StudentAliasEntry = {
      key,
      originalName: originalName.trim(),
      alias: trimmedAlias,
      group: resolvedGroup,
      updatedAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.notifyListeners();

    if (this.enableStorageSync) {
      await this.saveStorage();
    }
  }

  public async removeAlias(originalName: string): Promise<void> {
    const key = this.normalizeName(originalName);
    if (this.cache.delete(key)) {
      this.notifyListeners();
      if (this.enableStorageSync) {
        await this.saveStorage();
      }
    }
  }

  public getAllAliases(): StudentAliasEntry[] {
    return Array.from(this.cache.values()).sort((a, b) =>
      a.alias.localeCompare(b.alias, 'uk')
    );
  }

  public exportAliasesJson(): string {
    return JSON.stringify(this.getAllAliases(), null, 2);
  }

  public async importAliases(entries: StudentAliasEntry[]): Promise<number> {
    let count = 0;
    for (const item of entries) {
      if (item && item.originalName && item.alias) {
        const key = this.normalizeName(item.originalName);
        this.cache.set(key, {
          key,
          originalName: item.originalName.trim(),
          alias: item.alias.trim(),
          group: item.group ? item.group.trim() : undefined,
          updatedAt: item.updatedAt || Date.now(),
        });
        count++;
      }
    }

    this.notifyListeners();
    if (this.enableStorageSync) {
      await this.saveStorage();
    }
    return count;
  }

  public onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[MeetSwitcher:AliasManager] Listener error:', err);
      }
    }
  }

  private isExtensionContextValid(): boolean {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && !chrome.runtime.id) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readStorage(): Promise<StudentAliasMap> {
    return new Promise((resolve) => {
      try {
        if (!this.isExtensionContextValid()) {
          resolve({});
          return;
        }

        const storage = typeof chrome !== 'undefined' ? (chrome.storage?.sync || chrome.storage?.local) : null;
        if (!storage) {
          resolve({});
          return;
        }

        storage.get(this.storageKey, (res) => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            // Fallback to local
            chrome.storage?.local?.get(this.storageKey, (localRes) => {
              resolve((localRes?.[this.storageKey] as StudentAliasMap) || {});
            });
            return;
          }
          resolve((res?.[this.storageKey] as StudentAliasMap) || {});
        });
      } catch {
        resolve({});
      }
    });
  }

  private async saveStorage(): Promise<void> {
    const data: StudentAliasMap = {};
    for (const [key, entry] of this.cache.entries()) {
      data[key] = entry;
    }

    return new Promise((resolve) => {
      try {
        if (!this.isExtensionContextValid()) {
          resolve();
          return;
        }

        const storage = typeof chrome !== 'undefined' ? (chrome.storage?.sync || chrome.storage?.local) : null;
        if (!storage) {
          resolve();
          return;
        }

        storage.set({ [this.storageKey]: data }, () => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) {
            // Fallback to local storage if sync quota exceeded
            chrome.storage?.local?.set({ [this.storageKey]: data }, () => resolve());
          } else {
            resolve();
          }
        });
      } catch {
        resolve();
      }
    });
  }

  private listenToStorageChanges(): void {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
          if (changes[this.storageKey]) {
            const newData = (changes[this.storageKey].newValue as StudentAliasMap) || {};
            this.cache.clear();
            for (const [key, entry] of Object.entries(newData)) {
              this.cache.set(key, entry);
            }
            this.notifyListeners();
          }
        });
      }
    } catch {
      // Ignore in non-extension environments
    }
  }
}
