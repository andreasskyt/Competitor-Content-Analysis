/**
 * Job runner - in-process pipeline orchestrator.
 */

import { updateJob } from "./store";
import { getCache, isFresh, setCache } from "@/lib/cache/videoCache";
import { attachTranscripts } from "@/lib/transcripts/provider";
import { resolveChannelInput } from "@/lib/youtube/normalize";
import {
  getTopVideosForChannel,
  type YoutubeVideo,
} from "@/lib/youtube/client";
import { analyzeVideoItem } from "@/lib/llm/analyzeItem";
import {
  generateAggregateReport,
  type AggregateReport,
} from "@/lib/llm/generateReport";
import { writeJobOutput } from "@/lib/io/writeJobOutput";

const MAX_CHARS = 4000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";

interface OutputItem {
  platform: string;
  channelId: string;
  channelTitle: string;
  videoId: string;
  url: string;
  title: string;
  publishedAt: string;
  duration: string;
  stats: { views: number; likes: number; comments: number };
  transcript: {
    provider: string;
    text: string | null;
    truncated: boolean;
    error?: string;
    reason?: string;
  };
  analysis: {
    hook: string;
    power_words: string[];
    theme: string;
    format: string;
    cta_present: boolean;
    cta_type: string | null;
    why_it_worked_short: string;
    reason?: string;
  };
}

interface ResolvedSource {
  input: string;
  channelId: string;
  title: string;
  url: string;
  error?: string;
}

function sortItemsByViewsAndDate<T extends { stats: { views: number }; publishedAt: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    const viewsDiff = b.stats.views - a.stats.views;
    if (viewsDiff !== 0) return viewsDiff;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

const DEFAULT_REPORT = {
  top_videos: [],
  winning_patterns: [],
  top_hooks: [],
  content_formats: [],
  cta_patterns: [],
  content_ideas: [],
  key_takeaway: "",
  reason: "llm_error" as const,
};

export async function runJob(jobId: string): Promise<void> {
  const startTime = Date.now();
  const { getJob } = await import("./store");
  const job = getJob(jobId);
  if (!job || job.status !== "queued") return;

  let sources: ResolvedSource[] = [];
  let items: OutputItem[] = [];
  let transcriptMeta = {
    whisper_used: 0,
    skipped_due_to_budget: 0,
    skipped_due_to_duration: 0,
    transcript_cache_hits: 0,
  };
  let analysisCacheHits = 0;
  let report: AggregateReport = { ...DEFAULT_REPORT };
  let jobStatus: "done" | "failed" = "done";
  let jobError: string | undefined;

  try {
  updateJob(jobId, { status: "running", progress: { step: "normalizing channels", pct: 10 } });

  const { channels, topN, lookbackDays, whisperFallback, whisperTopK } = job.inputs;

  const sanitizedChannels = (channels ?? [])
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);

  for (const raw of sanitizedChannels) {
    try {
      const resolved = await resolveChannelInput(raw, YOUTUBE_API_KEY || undefined);
      if (resolved) {
        sources.push({
          input: resolved.input,
          channelId: resolved.channelId,
          title: resolved.title ?? resolved.input,
          url: resolved.url,
        });
      } else {
        sources.push({
          input: raw,
          channelId: "",
          title: raw,
          url: "",
          error: "channel_resolve_failed",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sources.push({
        input: raw,
        channelId: "",
        title: raw,
        url: "",
        error: msg.includes("YOUTUBE_API_KEY") ? "api_key_missing" : "channel_resolve_failed",
      });
    }
  }

  updateJob(jobId, { progress: { step: "fetching videos", pct: 30 } });

  const allVideos: YoutubeVideo[] = [];

  for (const src of sources) {
    if (!src.channelId || !YOUTUBE_API_KEY) continue;
    try {
      const top = await getTopVideosForChannel({
        channelId: src.channelId,
        lookbackDays,
        candidates: 50,
        topN,
      });
      allVideos.push(...top);
    } catch {
      continue;
    }
  }

  const effectiveWhisperTopK = job.inputs.whisperFallback ? whisperTopK : 0;

  updateJob(jobId, { progress: { step: "fetching transcripts", pct: 55 } });

  const attachResult = await attachTranscripts({
    videos: allVideos,
    whisperTopK: effectiveWhisperTopK,
    maxChars: MAX_CHARS,
  });
  const videosWithTranscripts = attachResult.videos;
  transcriptMeta = attachResult.meta;

  const rawItems: OutputItem[] = [];

  for (let idx = 0; idx < videosWithTranscripts.length; idx++) {
    const video = videosWithTranscripts[idx];

    updateJob(jobId, {
      progress: {
        step: "analyzing videos",
        pct: 55 + Math.floor((20 * (idx + 1)) / Math.max(videosWithTranscripts.length, 1)),
      },
    });

    let analysis;
    const cached = await getCache(video.videoId);
    if (cached?.analysis && isFresh(cached.cachedAt, 14)) {
      analysisCacheHits += 1;
      analysis = cached.analysis;
    } else {
      try {
        analysis = await analyzeVideoItem({
          title: video.title,
          description: video.description ?? "",
          transcript: video.transcript.text,
          stats: {
            views: video.stats.views,
            likes: video.stats.likes,
            comments: video.stats.comments,
          },
        });
        await setCache(video.videoId, {
          transcript: video.transcript,
          analysis,
        });
      } catch {
        analysis = {
          hook: "",
          power_words: [],
          theme: "",
          format: "",
          cta_present: false,
          cta_type: null,
          why_it_worked_short: "Analysis failed",
          reason: "llm_error",
        };
      }
    }

    rawItems.push({
      platform: "youtube",
      channelId: video.channelId,
      channelTitle: video.channelTitle,
      videoId: video.videoId,
      url: video.url,
      title: video.title,
      publishedAt: video.publishedAt,
      duration: video.duration,
      stats: {
        views: video.stats.views,
        likes: video.stats.likes ?? 0,
        comments: video.stats.comments ?? 0,
      },
      transcript: {
        provider: video.transcript.provider,
        text: video.transcript.text,
        truncated: video.transcript.truncated,
        ...(video.transcript.error && { error: video.transcript.error }),
        ...(video.transcript.reason && { reason: video.transcript.reason }),
      },
      analysis,
    });
  }

  items = sortItemsByViewsAndDate(rawItems);

  updateJob(jobId, { progress: { step: "generating report", pct: 90 } });

  const reportItems = items.map((i) => ({
    title: i.title,
    hook: i.analysis.hook,
    theme: i.analysis.theme,
    format: i.analysis.format,
    cta_present: i.analysis.cta_present,
    cta_type: i.analysis.cta_type,
    stats: { views: i.stats.views },
  }));

  if (items.length > 0) {
    report = await generateAggregateReport({ items: reportItems });
  } else {
    const anyApiKeyMissing = sources.some((s) => s.error === "api_key_missing");
    const allResolveFailed = sources.length > 0 && sources.every((s) => s.channelId === "");
    const hasResolved = sources.some((s) => s.channelId !== "");

    if (anyApiKeyMissing) {
      report = {
        ...DEFAULT_REPORT,
        reason: "no_api_key",
        key_takeaway: "YOUTUBE_API_KEY is not set.",
      };
    } else if (allResolveFailed) {
      report = {
        ...DEFAULT_REPORT,
        reason: "channel_resolve_failed",
        key_takeaway: "Could not resolve channel ID from input.",
      };
    } else if (hasResolved) {
      report = {
        ...DEFAULT_REPORT,
        reason: "no_videos_found",
        key_takeaway: "No videos found for the given channels and lookback period.",
      };
    }
  }

  const runtimeMs = Date.now() - startTime;
  const transcriptsUsed = items.filter((i) => i.transcript.text != null && i.transcript.text !== "")
    .length;

  const output = {
    job: {
      id: jobId,
      createdAt: job.createdAt,
      inputs: job.inputs,
      status: "done" as const,
      meta: {
        runtime_ms: runtimeMs,
        whisper_used: transcriptMeta.whisper_used,
        videos_skipped_due_to_budget: transcriptMeta.skipped_due_to_budget,
        videos_skipped_due_to_duration: transcriptMeta.skipped_due_to_duration,
        transcript_cache_hits: transcriptMeta.transcript_cache_hits ?? 0,
        analysis_cache_hits: analysisCacheHits,
      },
    },
    summary: {
      videos_analyzed: items.length,
      transcripts_used: transcriptsUsed,
      whisper_used: transcriptMeta.whisper_used,
    },
    sources: {
      channels: sources.map((s) => ({
        input: s.input,
        channelId: s.channelId,
        title: s.title,
        url: s.url,
        ...(s.error && { error: s.error }),
      })),
    },
    items,
    report,
  };

  updateJob(jobId, { progress: { step: "writing output", pct: 98 } });

  const relativePath = await writeJobOutput(jobId, output);
  const downloadUrl = `${BASE_URL}${relativePath}`;

  updateJob(jobId, {
    status: jobStatus,
    progress: { step: "done", pct: 100 },
    downloadUrl,
    ...(jobError && { error: jobError }),
  });
  } catch (err) {
    jobStatus = "failed";
    jobError = err instanceof Error ? err.message : String(err);
    const runtimeMs = Date.now() - startTime;
    const transcriptsUsed = items.filter((i) => i.transcript.text != null && i.transcript.text !== "")
      .length;

    const output = {
      job: {
        id: jobId,
        createdAt: job!.createdAt,
        inputs: job!.inputs,
        status: "failed" as const,
        error: jobError,
        meta: {
          runtime_ms: runtimeMs,
          whisper_used: transcriptMeta.whisper_used,
          videos_skipped_due_to_budget: transcriptMeta.skipped_due_to_budget,
          videos_skipped_due_to_duration: transcriptMeta.skipped_due_to_duration,
          transcript_cache_hits: transcriptMeta.transcript_cache_hits ?? 0,
          analysis_cache_hits: analysisCacheHits,
        },
      },
      summary: {
        videos_analyzed: items.length,
        transcripts_used: transcriptsUsed,
        whisper_used: transcriptMeta.whisper_used,
      },
      sources: {
        channels: sources.map((s) => ({
          input: s.input,
          channelId: s.channelId,
          title: s.title,
          url: s.url,
          ...(s.error && { error: s.error }),
        })),
      },
      items,
      report,
    };

    const relativePath = await writeJobOutput(jobId, output);
    const downloadUrl = `${BASE_URL}${relativePath}`;

    updateJob(jobId, {
      status: "failed",
      progress: { step: "failed", pct: 100 },
      downloadUrl,
      error: jobError,
    });
  }
}
