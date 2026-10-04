import { describe, it, expect } from "vitest";
import { isAllowedOrigin } from "./app";

/** CORS 源白名单：本机任意端口 + 云端自身地址；其余拒绝（曾放行任意 http:// 已收紧） */
describe("isAllowedOrigin", () => {
  it("allows localhost on any port", () => {
    expect(isAllowedOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("http://localhost")).toBe(true);
  });

  it("allows the configured cloud host origin", () => {
    expect(isAllowedOrigin("http://203.0.113.5:8787", "203.0.113.5:8787")).toBe(true);
    // 尾部斜杠与大小写容错
    expect(isAllowedOrigin("http://Example.COM:8787/", "example.com:8787")).toBe(false); // 带 / 不等
    expect(isAllowedOrigin("http://example.com:8787", " example.com:8787 ")).toBe(true);
  });

  it("rejects arbitrary external origins", () => {
    expect(isAllowedOrigin("http://evil.example.com", undefined)).toBe(false);
    expect(isAllowedOrigin("http://evil.example.com", "203.0.113.5:8787")).toBe(false);
    expect(isAllowedOrigin(undefined as unknown as string)).toBe(false);
    expect(isAllowedOrigin("file:///etc/passwd" as string)).toBe(false);
  });

  it("rejects non-http schemes and malformed input", () => {
    expect(isAllowedOrigin("ftp://localhost:5173")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });
});
