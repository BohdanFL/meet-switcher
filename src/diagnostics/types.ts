export type LogCategory =
  | 'SYSTEM'
  | 'SCAN'
  | 'ACTION'
  | 'MENU'
  | 'DOM'
  | 'ERROR'
  | 'WARN';

export interface DomTileInfo {
  id: string;
  tag: string;
  isPresentation: boolean;
  classificationReason: string;
  participantName: string;
  ariaLabel?: string | null;
  dataTileType?: string | null;
  buttons: Array<{
    ariaLabel?: string | null;
    tooltip?: string | null;
    text?: string | null;
    isPin?: boolean;
    isUnpin?: boolean;
  }>;
  textSnippet: string;
}

export interface DomSnapshot {
  timestamp: string;
  videoCount: number;
  isPinnedActive: boolean;
  tiles: DomTileInfo[];
}

export interface LogEvent {
  id: string;
  timestamp: string;
  elapsedMs: number;
  category: LogCategory;
  message: string;
  details?: Record<string, any>;
  snapshot?: DomSnapshot;
}

export interface SessionLog {
  id: string;
  startTime: string;
  endTime?: string;
  durationSeconds?: number;
  meetUrl: string;
  totalSwitches: number;
  successfulSwitches: number;
  failedSwitches: number;
  errorCount: number;
  detectedParticipants: string[];
  events: LogEvent[];
}

export interface LoggerConfig {
  maxEvents?: number;
  enableStorageSync?: boolean;
  maxStoredSessions?: number;
}
