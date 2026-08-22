export interface DetectedSkill {
  name: string;
  sourcePath: string;
}

export interface DetectedAgent {
  type: string;
  name: string;
  /** headless 调用命令（如 claude -p / codex exec） */
  headless: string;
  /** prompt 传递方式 */
  promptMode: "arg" | "stdin";
  cmd: string;
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
