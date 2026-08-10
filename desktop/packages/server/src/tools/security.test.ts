import { describe, it, expect } from "vitest";
import {
  hasShellMetacharacters,
  checkCommandAllowed,
  isDangerousCommand,
} from "./security";
import type { AppSettings } from "@ensemble/shared";

// ── hasShellMetacharacters ──────────────────────────────────────────────────

describe("hasShellMetacharacters", () => {
  it("should detect &&", () => {
    expect(hasShellMetacharacters("echo hello && rm -rf /")).toBe("&&");
  });

  it("should detect ||", () => {
    expect(hasShellMetacharacters("ls || cat /etc/passwd")).toBe("||");
  });

  it("should detect ;", () => {
    expect(hasShellMetacharacters("echo hi; rm -rf /")).toBe(";");
  });

  it("should detect |", () => {
    expect(hasShellMetacharacters("cat file | grep foo")).toBe("|");
  });

  it("should detect backticks", () => {
    expect(hasShellMetacharacters("echo `whoami`")).toBe("`");
  });

  it("should detect $()", () => {
    expect(hasShellMetacharacters("echo $(whoami)")).toBe("$(");
  });

  it("should allow safe commands", () => {
    expect(hasShellMetacharacters("npm install")).toBeNull();
    expect(hasShellMetacharacters("git status")).toBeNull();
    expect(hasShellMetacharacters("node index.js")).toBeNull();
    expect(hasShellMetacharacters("echo hello world")).toBeNull();
  });
});

// ── isDangerousCommand ──────────────────────────────────────────────────────

describe("isDangerousCommand", () => {
  it("should detect rm", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
  });

  it("should detect shutdown", () => {
    expect(isDangerousCommand("shutdown -h now")).toBe(true);
  });

  it("should detect format", () => {
    expect(isDangerousCommand("format C:")).toBe(true);
  });

  it("should allow safe commands", () => {
    expect(isDangerousCommand("npm install")).toBe(false);
    expect(isDangerousCommand("git push")).toBe(false);
  });

  it("should handle env var prefixes", () => {
    expect(isDangerousCommand("NODE_ENV=prod rm -rf /")).toBe(true);
    expect(isDangerousCommand("NODE_ENV=prod node index.js")).toBe(false);
  });
});

// ── checkCommandAllowed ─────────────────────────────────────────────────────

describe("checkCommandAllowed", () => {
  const defaultSecurity: AppSettings["security"] = {
    allowNetwork: true,
    allowFileRead: true,
    allowFileWrite: true,
  };

  it("should return null when security is undefined", () => {
    expect(checkCommandAllowed("rm -rf /", undefined)).toBeNull();
  });

  it("should block shell metacharacters (command injection)", () => {
    const security: AppSettings["security"] = { ...defaultSecurity };
    expect(checkCommandAllowed("echo hello && rm -rf /", security)).toContain("shell 元字符");
  });

  // ── blocked commands (blacklist) ──────────────────────────────────────────

  describe("blocked commands (blacklist)", () => {
    it("should block a command matching a blocked pattern", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        blockedCommands: ["rm"],
      };
      expect(checkCommandAllowed("rm -rf /", security)).toContain("黑名单");
    });

    it("should not match blocked pattern inside a word (word boundary)", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        blockedCommands: ["rm"],
      };
      // "firmware" contains "rm" but should NOT be blocked
      expect(checkCommandAllowed("firmware --update", security)).toBeNull();
    });

    it("should match blocked pattern at word boundary after dot", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        blockedCommands: ["rm"],
      };
      expect(checkCommandAllowed("./rm -rf /", security)).toContain("黑名单");
    });
  });

  // ── allowed commands (whitelist) ──────────────────────────────────────────

  describe("allowed commands (whitelist)", () => {
    it("should allow a command on the whitelist", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        allowedCommands: ["npm", "git"],
      };
      expect(checkCommandAllowed("npm install", security)).toBeNull();
    });

    it("should block a command not on the whitelist", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        allowedCommands: ["npm", "git"],
      };
      expect(checkCommandAllowed("curl http://example.com", security)).toContain("白名单");
    });

    it("should match first token only (no bypass with semicolon)", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        allowedCommands: ["npm"],
      };
      // Even though "npm" is allowed, this has metacharacters so is blocked first
      expect(checkCommandAllowed("npm;rm -rf /", security)).toContain("shell 元字符");
    });

    it("should handle .exe extensions in whitelist matching", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        allowedCommands: ["npm"],
      };
      expect(checkCommandAllowed("npm.exe install", security)).toBeNull();
    });
  });

  // ── dangerous commands ────────────────────────────────────────────────────

  describe("dangerous commands", () => {
    it("should block dangerous commands by default", () => {
      const security: AppSettings["security"] = { ...defaultSecurity };
      expect(checkCommandAllowed("rm -rf /", security)).toContain("危险命令");
    });

    it("should allow dangerous commands when allowDangerousCommands is true", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        allowDangerousCommands: true,
      };
      expect(checkCommandAllowed("rm -rf /tmp/old", security)).toBeNull();
    });
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should not block firmware by rm rule", () => {
      const security: AppSettings["security"] = {
        ...defaultSecurity,
        blockedCommands: ["rm"],
        allowDangerousCommands: true,
      };
      expect(checkCommandAllowed("firmware --flash", security)).toBeNull();
    });

    it("should handle empty command", () => {
      const security: AppSettings["security"] = { ...defaultSecurity };
      expect(checkCommandAllowed("", security)).toBeNull();
    });

    it("should handle whitespace-only command", () => {
      const security: AppSettings["security"] = { ...defaultSecurity };
      expect(checkCommandAllowed("   ", security)).toBeNull();
    });
  });
});
