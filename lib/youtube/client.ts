/**
 * YouTube Data API v3 client.
 */

import { youtubeGet, youtubeGetWithDebug } from "./http";

export type YoutubeVideo = {
  videoId: string;
  url: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  duration: string;
  thumbnails: {
    default?: string;
    medium?: string;
    high?: string;
    maxres?: string;
  };
  stats: {
    views: number;
    likes?: number;
    comments?: number;
  };
  caption: boolean;
};

interface SearchListResponse {
  nextPageToken?: string;
  items?: Array<{ id?: { videoId?: string } }>;
}

export async function searchRecentVideoIds(params: {
  channelId: string;
  lookbackDays: number;
  maxResults: number;
}): Promise<string[]> {
  const { channelId, lookbackDays, maxResults } = params;
  const publishedAfter = new Date();
  publishedAfter.setDate(publishedAfter.getDate() - lookbackDays);
  const publishedAfterIso = publishedAfter.toISOString();

  const seen = new Set<string>();
  let pageToken: string | undefined;
  const pageSize = Math.min(50, maxResults);

  do {
    const params: Record<string, string | number> = {
      part: "snippet",
      channelId,
      type: "video",
      publishedAfter: publishedAfterIso,
      order: "date",
      maxResults: pageSize,
    };
    if (pageToken) params.pageToken = pageToken;

    const data = await youtubeGet<SearchListResponse>("/search", params);

    for (const item of data.items ?? []) {
      const id = item.id?.videoId;
      if (id) seen.add(id);
    }

    if (seen.size >= maxResults) break;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return Array.from(seen).slice(0, maxResults);
}

interface VideosListResponse {
  items?: Array<{
    id: string;
    snippet?: {
      channelId?: string;
      channelTitle?: string;
      title?: string;
      description?: string;
      publishedAt?: string;
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
        high?: { url?: string };
        maxres?: { url?: string };
      };
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    contentDetails?: {
      duration?: string;
      caption?: string;
    };
  }>;
}

function parseCount(v: string | undefined): number {
  if (v == null) return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

export async function fetchVideosByIds(videoIds: string[]): Promise<YoutubeVideo[]> {
  const results: YoutubeVideo[] = [];
  const chunkSize = 50;

  for (let i = 0; i < videoIds.length; i += chunkSize) {
    const chunk = videoIds.slice(i, i + chunkSize);
    const ids = chunk.join(",");

    const data = await youtubeGet<VideosListResponse>("/videos", {
      part: "snippet,statistics,contentDetails",
      id: ids,
    });

    for (const item of data.items ?? []) {
      const thumbnails = item.snippet?.thumbnails ?? {};
      results.push({
        videoId: item.id,
        url: `https://www.youtube.com/watch?v=${item.id}`,
        channelId: item.snippet?.channelId ?? "",
        channelTitle: item.snippet?.channelTitle ?? "",
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        duration: item.contentDetails?.duration ?? "PT0S",
        thumbnails: {
          default: thumbnails.default?.url,
          medium: thumbnails.medium?.url,
          high: thumbnails.high?.url,
          maxres: thumbnails.maxres?.url,
        },
        stats: {
          views: parseCount(item.statistics?.viewCount),
          likes: item.statistics?.likeCount ? parseCount(item.statistics.likeCount) : undefined,
          comments: item.statistics?.commentCount
            ? parseCount(item.statistics.commentCount)
            : undefined,
        },
        caption: item.contentDetails?.caption === "true",
      });
    }
  }

  return results;
}

export interface ChannelInfo {
  channelId: string;
  title: string;
  url: string;
}

export interface GetChannelByHandleDebug {
  requestedHandle: string;
  requestUrl: string;
  responseStatus: number;
  responseError?: unknown;
  itemsCount: number;
}

export async function getChannelByHandle(
  handle: string,
  options?: { debug?: boolean }
): Promise<ChannelInfo | null | { channel: ChannelInfo | null; debug: GetChannelByHandleDebug }> {
  const forHandle = handle.startsWith("@") ? handle : `@${handle}`;

  if (options?.debug) {
    const result = await youtubeGetWithDebug<{
      items?: Array<{ id: string; snippet?: { title?: string } }>;
    }>("/channels", {
      part: "snippet",
      forHandle,
    });

    const debug: GetChannelByHandleDebug = {
      requestedHandle: forHandle,
      requestUrl: result.requestUrl,
      responseStatus: result.responseStatus,
      responseError: result.responseError,
      itemsCount: result.ok && result.data?.items ? result.data.items.length : 0,
    };

    if (result.ok && result.data?.items?.[0]) {
      const item = result.data.items[0];
      const channel: ChannelInfo = {
        channelId: item.id,
        title: item.snippet?.title ?? "Unknown",
        url: `https://www.youtube.com/channel/${item.id}`,
      };
      return { channel, debug };
    }
    return { channel: null, debug };
  }

  const data = await youtubeGet<{
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  }>("/channels", {
    part: "snippet",
    forHandle,
  });
  const item = data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? "Unknown",
    url: `https://www.youtube.com/channel/${item.id}`,
  };
}

export async function resolveChannelIdFromSearch(query: string): Promise<string | null> {
  const data = await youtubeGet<{
    items?: Array<{ id?: { channelId?: string }; snippet?: { channelId?: string } }>;
  }>("/search", {
    part: "snippet",
    type: "channel",
    q: query,
    maxResults: 1,
  });
  const item = data.items?.[0];
  return item?.id?.channelId ?? item?.snippet?.channelId ?? null;
}

export async function getChannelInfo(channelId: string): Promise<ChannelInfo | null> {
  const data = await youtubeGet<{
    items?: Array<{ id: string; snippet?: { title?: string } }>;
  }>("/channels", {
    part: "snippet",
    id: channelId,
  });
  const item = data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? "Unknown",
    url: `https://www.youtube.com/channel/${item.id}`,
  };
}

export async function getTopVideosForChannel(params: {
  channelId: string;
  lookbackDays: number;
  candidates?: number;
  topN?: number;
}): Promise<YoutubeVideo[]> {
  const {
    channelId,
    lookbackDays,
    candidates = 50,
    topN = 5,
  } = params;

  const ids = await searchRecentVideoIds({
    channelId,
    lookbackDays,
    maxResults: candidates,
  });

  const vids = await fetchVideosByIds(ids);
  vids.sort((a, b) => b.stats.views - a.stats.views);
  return vids.slice(0, topN);
}
