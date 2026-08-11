import { describe, it, expect, afterEach, vi } from "vitest";
import { embedTexts } from "./embedding";

/** 测试 embedTexts：mock 全局 fetch，验证请求格式与响应解析 */
describe("embedTexts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to {baseUrl}/embeddings and parses vectors", async () => {
    let calledUrl = "";
    let calledBody: { model?: string; input?: string[] } = {};
    let calledHeaders: Record<string, string> = {};

    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calledUrl = url;
      calledBody = JSON.parse(String(init.body));
      calledHeaders = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          data: calledBody.input!.map((_t, i) => ({ embedding: [i + 1, 0] })),
        }),
      );
    });

    const result = await embedTexts(
      { baseUrl: "http://localhost:11434/v1", model: "nomic-embed-text", apiKey: "sk-test" },
      ["alpha", "beta"],
    );

    expect(calledUrl).toBe("http://localhost:11434/v1/embeddings");
    expect(calledBody.model).toBe("nomic-embed-text");
    expect(calledBody.input).toEqual(["alpha", "beta"]);
    expect(calledHeaders.authorization).toBe("Bearer sk-test");
    expect(result).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  it("strips trailing slash from baseUrl and sends Bearer once for already-prefixed keys", async () => {
    let calledUrl = "";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calledUrl = url;
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ data: body.input.map(() => ({ embedding: [1] })) }));
    });

    await embedTexts(
      { baseUrl: "http://x/v1/", model: "m", apiKey: "Bearer pre-key" },
      ["a"],
    );
    expect(calledUrl).toBe("http://x/v1/embeddings");
  });

  it("returns empty array for empty input without fetching", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const result = await embedTexts({ baseUrl: "http://x", model: "m" }, []);
    expect(result).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("throws on malformed response (row count mismatch)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ data: [{ embedding: [1] }] })),
    );
    await expect(
      embedTexts({ baseUrl: "http://x", model: "m" }, ["a", "b"]),
    ).rejects.toThrow(/malformed/);
  });

  it("throws on missing vector in a row", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ data: [{ foo: 1 }, { embedding: [1] }] })),
    );
    await expect(
      embedTexts({ baseUrl: "http://x", model: "m" }, ["a", "b"]),
    ).rejects.toThrow(/malformed/);
  });
});
