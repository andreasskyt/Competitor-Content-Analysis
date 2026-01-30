/**
 * Transcript provider - attaches transcripts to videos with cost controls.
 */

import type { YoutubeVideo } from "@/lib/youtube/client";
import { getCache, isFresh, setCache } from "@/lib/cache/videoCache";
import { parseIsoDurationToSeconds } from "@/lib/youtube/duration";
import type { TranscriptResult } from "./types";
import { transcribeYouTubeWithWhisper } from "./whisper";

const MAX_DURATION_SECONDS = 720; // 12 minutes
const CACHE_MAX_AGE_DAYS = 14;

export interface AttachTranscriptsMeta {
  whisper_used: number;
  skipped_due_to_budget: number;
  skipped_due_to_duration: number;
  transcript_cache_hits: number;
}

/**
 * Attach transcripts to videos. Whisper budget is allocated by view rank (best first).
 * Returns videos in original input order with transcript attached.
 */
export async function attachTranscripts(params: {
  videos: YoutubeVideo[];
  whisperTopK: number;
  maxChars: number;
}): Promise<{
  videos: Array<YoutubeVideo & { transcript: TranscriptResult }>;
  meta: AttachTranscriptsMeta;
}> {
  const { videos, whisperTopK, maxChars } = params;

  const withIndex = videos.map((v, i) => ({ video: v, originalIndex: i }));
  const byViews = [...withIndex].sort(
    (a, b) => (b.video.stats.views ?? 0) - (a.video.stats.views ?? 0)
  );

  const transcriptByVideoId = new Map<string, TranscriptResult>();
  let whisperUsed = 0;
  let skippedDueToBudget = 0;
  let skippedDueToDuration = 0;
  let transcriptCacheHits = 0;

  for (let idx = 0; idx < byViews.length; idx++) {
    const { video } = byViews[idx];
    const globalRank = idx + 1;
    const durationSeconds = parseIsoDurationToSeconds(video.duration);
    const isRank1 = globalRank === 1;
    const exceedsDuration = durationSeconds > MAX_DURATION_SECONDS;

    if (video.caption === true) {
      transcriptByVideoId.set(video.videoId, {
        provider: "captions",
        text: null,
        truncated: false,
      });
    } else if (!isRank1 && exceedsDuration) {
      skippedDueToDuration += 1;
      transcriptByVideoId.set(video.videoId, {
        provider: "none",
        text: null,
        truncated: false,
        reason: "skipped_long_video",
      });
    } else if (whisperTopK - whisperUsed > 0) {
      let result: TranscriptResult;
      const cached = await getCache(video.videoId);
      if (
        cached?.transcript &&
        isFresh(cached.cachedAt, CACHE_MAX_AGE_DAYS)
      ) {
        transcriptCacheHits += 1;
        result = cached.transcript as TranscriptResult;
      } else {
        const whisperResult = await transcribeYouTubeWithWhisper({
          videoUrl: video.url,
          maxChars,
        });

        whisperUsed += 1;

        if (whisperResult.error) {
          result = {
            provider: "none",
            text: null,
            truncated: false,
            error: whisperResult.error,
            reason: "whisper_error",
          };
        } else {
          result = {
            provider: "whisper",
            text: whisperResult.text,
            truncated: whisperResult.truncated,
          };
          await setCache(video.videoId, { transcript: result });
        }
      }
      transcriptByVideoId.set(video.videoId, result);
    } else {
      skippedDueToBudget += 1;
      transcriptByVideoId.set(video.videoId, {
        provider: "none",
        text: null,
        truncated: false,
        reason: "budget_exceeded",
      });
    }
  }

  const resultVideos = videos.map((video) => ({
    ...video,
    transcript: transcriptByVideoId.get(video.videoId) ?? {
      provider: "none" as const,
      text: null,
      truncated: false,
      reason: "unavailable" as const,
    },
  }));

  return {
    videos: resultVideos,
    meta: {
      whisper_used: whisperUsed,
      skipped_due_to_budget: skippedDueToBudget,
      skipped_due_to_duration: skippedDueToDuration,
      transcript_cache_hits: transcriptCacheHits,
    },
  };
}
