export interface Capabilities {
  sessionResume: boolean;
  partialStreaming: boolean;
  toolUseEvents: boolean;
  concurrent: boolean;
  cwdConfigurable: boolean;
  notes?: string[];
}

export function defaultCapabilities(kind: "claude-code" | "hermes"): Capabilities {
  if (kind === "claude-code") {
    return {
      sessionResume: true,
      partialStreaming: true,
      toolUseEvents: true,
      concurrent: false,
      cwdConfigurable: true,
    };
  }
  return {
    sessionResume: true,
    partialStreaming: false,
    toolUseEvents: false,
    concurrent: true,
    cwdConfigurable: true,
    notes: ["Hermes CLI 无 token 级流式"],
  };
}
