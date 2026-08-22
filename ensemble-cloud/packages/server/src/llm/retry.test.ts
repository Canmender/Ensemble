import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchWithRetry } from "./retry";

/**
 * Helper: create a mock Response with the given status and optional headers.
 */
function mockResponse(
  status: number,
  headers?: Record<string, string>,
  body = "error body",
): Response {
  const h = new Headers(headers);
  return new Response(body, { status, headers: h });
}

// We need to mock the global `fetch` since retry.ts uses it.
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

// ── retryable status codes ──────────────────────────────────────────────────

describe("fetchWithRetry — retryable status codes", () => {
  const retryable = [429, 500, 502, 503, 504];

  for (const status of retryable) {
    it(`should retry on HTTP ${status} and eventually succeed`, async () => {
      const okResponse = new Response("ok", { status: 200 });

      // Fail twice with the retryable status, then succeed.
      fetchMock
        .mockResolvedValueOnce(mockResponse(status))
        .mockResolvedValueOnce(mockResponse(status))
        .mockResolvedValueOnce(okResponse);

      const result = await fetchWithRetry(
        "https://api.example.com/test",
        {},
        "test",
        { maxRetries: 3, baseDelayMs: 1 },
      );

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  }

  it("should throw after maxRetries is exhausted", async () => {
    fetchMock.mockResolvedValue(mockResponse(500));

    await expect(
      fetchWithRetry(
        "https://api.example.com/test",
        {},
        "ctx",
        { maxRetries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow();

    // Initial attempt + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ── non-retryable status codes ──────────────────────────────────────────────

describe("fetchWithRetry — non-retryable status codes", () => {
  const nonRetryable = [400, 401, 403, 404];

  for (const status of nonRetryable) {
    it(`should throw immediately on HTTP ${status} without retrying`, async () => {
      fetchMock.mockResolvedValue(mockResponse(status));

      await expect(
        fetchWithRetry(
          "https://api.example.com/test",
          {},
          "ctx",
          { maxRetries: 3, baseDelayMs: 1 },
        ),
      ).rejects.toThrow();

      // Only the initial attempt — no retries
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }
});

// ── Retry-After header ──────────────────────────────────────────────────────

describe("fetchWithRetry — Retry-After header", () => {
  it("should respect numeric Retry-After (seconds)", async () => {
    const okResponse = new Response("ok", { status: 200 });

    fetchMock
      .mockResolvedValueOnce(
        mockResponse(429, { "retry-after": "2" }),
      )
      .mockResolvedValueOnce(okResponse);

    // Use a tiny baseDelay so the test is fast; the Retry-After value
    // overrides it but we clamp to max 100ms for tests.
    const result = await fetchWithRetry(
      "https://api.example.com/test",
      {},
      "ctx",
      { maxRetries: 3, baseDelayMs: 1 },
    );

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ── AbortSignal ─────────────────────────────────────────────────────────────

describe("fetchWithRetry — AbortSignal", () => {
  it("should abort immediately if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchWithRetry(
        "https://api.example.com/test",
        { signal: controller.signal },
        "ctx",
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow("aborted");

    // Should not have called fetch at all
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("should abort mid-retry when signal fires", async () => {
    const controller = new AbortController();

    // First call returns 500 (retryable), then we abort before the second attempt
    fetchMock.mockImplementationOnce(async () => {
      // Abort while "waiting"
      controller.abort();
      return mockResponse(500);
    });

    await expect(
      fetchWithRetry(
        "https://api.example.com/test",
        { signal: controller.signal },
        "ctx",
        { maxRetries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow();
  });
});
