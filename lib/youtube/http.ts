/**
 * YouTube Data API v3 HTTP helper.
 * Appends API key, handles retries on 429/5xx.
 */

const BASE = "https://www.googleapis.com/youtube/v3";

const BACKOFF_MS = [300, 800, 1500];

function buildUrl(path: string, params: Record<string, string | number | undefined>): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  );
  const search = new URLSearchParams({ ...filtered, key } as Record<string, string>);
  return `${BASE}${path}?${search.toString()}`;
}

export interface YoutubeGetDebugResult<T> {
  ok: boolean;
  data?: T;
  requestUrl: string;
  responseStatus: number;
  responseError?: unknown;
  errorBody?: string;
}

export async function youtubeGetWithDebug<T>(
  path: string,
  queryParams: Record<string, string | number | undefined> = {}
): Promise<YoutubeGetDebugResult<T>> {
  const requestUrl = buildUrl(path, queryParams);

  try {
    const res = await fetch(requestUrl);
    const bodyText = await res.text();

    if (res.ok) {
      try {
        const data = JSON.parse(bodyText) as T;
        return { ok: true, data, requestUrl, responseStatus: res.status };
      } catch {
        return {
          ok: false,
          requestUrl,
          responseStatus: res.status,
          errorBody: bodyText,
          responseError: { parseError: "Invalid JSON" },
        };
      }
    }

    let responseError: unknown;
    try {
      responseError = JSON.parse(bodyText);
    } catch {
      responseError = bodyText;
    }
    return {
      ok: false,
      requestUrl,
      responseStatus: res.status,
      errorBody: bodyText,
      responseError,
    };
  } catch (e) {
    return {
      ok: false,
      requestUrl,
      responseStatus: 0,
      responseError: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function youtubeGet<T>(
  path: string,
  queryParams: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = buildUrl(path, queryParams);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      const res = await fetch(url);
      const isRetryable = res.status === 429 || res.status >= 500;

      if (res.ok) {
        return (await res.json()) as T;
      }

      const body = await res.text();
      const err = new Error(`YouTube API ${res.status}: ${body}`);

      if (isRetryable && attempt < BACKOFF_MS.length) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        lastError = err;
        continue;
      }

      throw err;
    } catch (e) {
      if (e instanceof Error && attempt < BACKOFF_MS.length) {
        lastError = e;
        await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        continue;
      }
      throw e;
    }
  }

  throw lastError ?? new Error("YouTube API request failed");
}
