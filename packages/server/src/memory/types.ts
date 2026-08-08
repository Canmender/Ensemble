export interface MemoryDailyEntry {
  date: string;
  sizeBytes: number;
  lineCount: number;
  updatedAt: string;
}

export interface MemorySnapshot {
  agentId: string;
  memoryFile?: { content: string; updatedAt: string; sizeBytes: number };
  dailyLogs: MemoryDailyEntry[];
  stats: {
    lastFlushAt?: string;
    lastConsolidateAt?: string;
    flushCount: number;
    consolidateCount: number;
    memUsageTokens?: number;
  };
}
