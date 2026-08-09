type Level = "debug" | "info" | "warn" | "error";

const LEVEL_PREFIX: Record<Level, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
};

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(level: Level, msg: string, meta?: unknown): void {
  const parts = [`[${ts()}]`, LEVEL_PREFIX[level], msg];
  if (meta !== undefined) parts.push(typeof meta === "string" ? meta : JSON.stringify(meta));
  const line = parts.join(" ");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log("debug", msg, meta),
  info: (msg: string, meta?: unknown) => log("info", msg, meta),
  warn: (msg: string, meta?: unknown) => log("warn", msg, meta),
  error: (msg: string, meta?: unknown) => log("error", msg, meta),
};
