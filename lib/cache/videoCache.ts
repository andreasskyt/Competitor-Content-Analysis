/**
 * Filesystem cache for transcript and per-video analysis by videoId.
 * Reduces Whisper + LLM costs for repeated analysis of the same video.
 */

import fs from "fs";
import path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "videos");
const MAX_AGE_DAYS = 14;

export interface CachedVideoData {
  transcript?: {
    provider: string;
    text: string | null;
    truncated: boolean;
    error?: string;
    reason?: string;
  };
  analysis?: {
    hook: string;
    power_words: string[];
    theme: string;
    format: string;
    cta_present: boolean;
    cta_type: string | null;
    why_it_worked_short: string;
    reason?: string;
  };
  cachedAt: string;
}

export function isFresh(cachedAt: string, maxAgeDays: number = MAX_AGE_DAYS): boolean {
  try {
    const age = Date.now() - new Date(cachedAt).getTime();
    return age < maxAgeDays * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function getCache(videoId: string): Promise<CachedVideoData | null> {
  try {
    const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(CACHE_DIR, `${safeId}.json`);
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as CachedVideoData;
    if (!data || typeof data.cachedAt !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

export async function setCache(
  videoId: string,
  data: Partial<Omit<CachedVideoData, "cachedAt">>
): Promise<void> {
  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    const safeId = videoId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = path.join(CACHE_DIR, `${safeId}.json`);

    let existing: CachedVideoData | null = null;
    try {
      const raw = await fs.promises.readFile(filePath, "utf-8");
      existing = JSON.parse(raw) as CachedVideoData;
    } catch {
      /* no existing file */
    }

    const merged: CachedVideoData = {
      ...existing,
      ...data,
      cachedAt: new Date().toISOString(),
    };
    await fs.promises.writeFile(
      filePath,
      JSON.stringify(merged, null, 0),
      "utf-8"
    );
  } catch {
    /* never crash on cache write */
  }
}
