export interface DetectedSkill {
  name: string;
  sourcePath: string;
}

export interface DetectedAgent {
  type: "claude" | "hermes";
  name: string;
  version?: string;
  configPath?: string;
  memoryDbPath?: string;
  skills: DetectedSkill[];
  memoryCount: number;
}

export interface SyncResult {
  type: string;
  importedSkills: string[];
  importedMemory: number;
  createdAgent?: string;
  errors: string[];
}
