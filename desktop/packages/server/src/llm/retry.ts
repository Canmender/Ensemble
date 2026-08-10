/**
 * Retry wrapper for HTTP fetch calls with exponential backoff.
 *
 * - Retries on HTTP 429, 500, 502, 503, 504
 * - Respects the `Retry-After` header on 429 responses
 * - Does NOT retry on 4xx errors (except 429) — those are client errors
 * - Logs each retry attempt
 * - Aborts immediately if the provided AbortSignal is already aborted
 */

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface RetryOptions {
  /** Maximum number of retries after the initial attempt (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds for exponential backoff (default: 1000) */
  baseDelayMs?: number;
}

/**
 * Fetch with automatic retry and exponential backoff.
 *
 * On retryable HTTP errors the response body is consumed and discarded before
 * sleeping, so the underlying connection is freed. On non-retryable errors the
 * original `throwOnHttpError`-style error is thrown with a `.code` property.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  context: string,
  opts?: RetryOptions,
): Promise<Response> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // If the caller's AbortSignal is already aborted, don't bother fetching.
    if (init.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const res = await fetch(url, init);

    // Happy path — return immediately.
    if (res.ok) return res;

    // Non-retryable error or retries exhausted — throw with context.
    if (!RETRYABLE_STATUS.has(res.status) || attempt >= maxRetries) {
      await throwHttpError(res, context);
    }

    // --- Retryable path ---
    const retryAfterHeader = res.headers.get("retry-after");
    let delay: number;

    if (retryAfterHeader) {
      // Retry-After can be a number of seconds or an HTTP-date.
      const parsedSeconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedSeconds)) {
        delay = parsedSeconds * 1000;
      } else {
        // Try parsing as HTTP-date
        const retryDate = Date.parse(retryAfterHeader);
        delay = isNaN(retryDate) ? baseDelayMs * 2 ** attempt : Math.max(0, retryDate - Date.now());
      }
    } else {
      delay = baseDelayMs * 2 ** attempt;
    }

    // Clamp to at least 100ms to avoid a zero-delay spin.
    delay = Math.max(delay, 100);

    // Consume body to free the connection before sleeping.
    await res.text().catch(() => {});

    console.warn(
      `[${context}] Retry ${attempt + 1}/${maxRetries} — HTTP ${res.status}, waiting ${delay}ms`,
    );
    await sleep(delay);
  }

  // Unreachable (loop always throws or returns), but satisfies TypeScript.
  throw new Error(`[${context}] retries exhausted`);
}

// ── internal helpers ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throwHttpError(res: Response, context: string): Promise<never> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  const err = new Error(
    `[${context}] HTTP ${res.status}: ${detail}`,
  ) as Error & { code?: string };
  err.code = `http_${res.status}`;
  throw err;
}
