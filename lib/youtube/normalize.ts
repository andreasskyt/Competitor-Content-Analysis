/**
 * Normalizes channel input (URL or ID) to channelId.
 */

import {
  getChannelByHandle,
  resolveChannelIdFromSearch,
  getChannelInfo,
} from "@/lib/youtube/client";

const CHANNEL_ID_REGEX = /^UC[\w-]{20,30}$/;
const HANDLE_ALLOWED_CHARS = /[A-Za-z0-9._-]/g;

export function extractHandleFromUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    return null;
  }
  const pathname = url.pathname;
  const atIdx = pathname.indexOf("/@");
  if (atIdx === -1) return null;

  const afterAt = pathname.slice(atIdx + 2);
  const nextSlash = afterAt.indexOf("/");
  const segment = nextSlash === -1 ? afterAt : afterAt.slice(0, nextSlash);

  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    decoded = segment;
  }

  const withoutAt = decoded.startsWith("@") ? decoded.slice(1) : decoded;
  const trimmed = withoutAt.trim();
  const allowed = trimmed.match(HANDLE_ALLOWED_CHARS)?.join("") ?? "";

  return allowed || null;
}

export interface ResolvedChannel {
  input: string;
  channelId: string;
  url: string;
  title?: string;
}

/**
 * Resolve channel input (URL or ID) to channelId and normalized URL.
 * Returns null if resolution fails.
 */
export async function resolveChannelInput(
  input: string,
  apiKey?: string
): Promise<ResolvedChannel | null> {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let channelId: string | null = null;
  let searchQuery: string | null = null;
  let isHandle = false;

  if (CHANNEL_ID_REGEX.test(trimmed)) {
    channelId = trimmed;
  } else if (/youtube\.com\/channel\/(UC[\w-]+)/i.test(trimmed)) {
    const match = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
    if (match) channelId = match[1];
  } else if (/youtube\.com\/@/i.test(trimmed) || trimmed.includes("/@")) {
    const handle = extractHandleFromUrl(trimmed);
    if (!handle) return null;
    searchQuery = handle;
    isHandle = true;
  } else if (/youtube\.com\/c\/([\w.-]+)/i.test(trimmed)) {
    const match = trimmed.match(/youtube\.com\/c\/([\w.-]+)/i);
    if (match) searchQuery = match[1];
  } else if (/youtube\.com\/user\/([\w.-]+)/i.test(trimmed)) {
    const match = trimmed.match(/youtube\.com\/user\/([\w.-]+)/i);
    if (match) searchQuery = match[1];
  } else {
    searchQuery = trimmed;
  }

  if (searchQuery) {
    if (!apiKey) return null;
    try {
      if (isHandle) {
        const info = await getChannelByHandle(searchQuery);
        if (info && "channelId" in info) {
          return { input: trimmed, channelId: info.channelId, url: info.url, title: info.title };
        }
        channelId = await resolveChannelIdFromSearch(searchQuery) ?? null;
      } else {
        channelId = await resolveChannelIdFromSearch(searchQuery);
      }
    } catch {
      return null;
    }
  }

  if (!channelId) return null;

  const url = `https://www.youtube.com/channel/${channelId}`;
  let title: string | undefined;
  if (apiKey) {
    try {
      const info = await getChannelInfo(channelId);
      title = info?.title;
    } catch {
      /* ignore */
    }
  }

  return { input: trimmed, channelId, url, title };
}

/** @deprecated Use resolveChannelInput */
export interface NormalizedChannel {
  input: string;
  channelId: string | null;
  resolvedFrom: "id" | "url" | "search";
  searchQuery?: string;
}

/** @deprecated Use resolveChannelInput */
export function parseChannelInput(input: string): NormalizedChannel | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (CHANNEL_ID_REGEX.test(trimmed)) {
    return { input: trimmed, channelId: trimmed, resolvedFrom: "id" };
  }
  const channelMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (channelMatch) {
    return { input: trimmed, channelId: channelMatch[1], resolvedFrom: "url" };
  }
  const handleMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/i);
  if (handleMatch) {
    return {
      input: trimmed,
      channelId: null,
      resolvedFrom: "search",
      searchQuery: handleMatch[1],
    };
  }
  const cMatch = trimmed.match(/youtube\.com\/c\/([\w.-]+)/i);
  if (cMatch) {
    return {
      input: trimmed,
      channelId: null,
      resolvedFrom: "search",
      searchQuery: cMatch[1],
    };
  }
  const userMatch = trimmed.match(/youtube\.com\/user\/([\w.-]+)/i);
  if (userMatch) {
    return {
      input: trimmed,
      channelId: null,
      resolvedFrom: "search",
      searchQuery: userMatch[1],
    };
  }
  return {
    input: trimmed,
    channelId: null,
    resolvedFrom: "search",
    searchQuery: trimmed,
  };
}
