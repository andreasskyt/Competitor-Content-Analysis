import { NextResponse } from "next/server";
import { getTopVideosForChannel, fetchVideosByIds } from "@/lib/youtube/client";

export const runtime = "nodejs";
import { attachTranscripts } from "@/lib/transcripts/provider";
import { analyzeVideoItem } from "@/lib/llm/analyzeItem";
import { generateAggregateReport } from "@/lib/llm/generateReport";

export async function GET(request: Request) {
  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY is not set. Add it to .env" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const topN = Math.min(Math.max(Number(searchParams.get("topN")) || 5, 1), 20);
  const lookbackDays = Math.min(Math.max(Number(searchParams.get("lookbackDays")) || 90, 1), 365);

  // No channelId: use TEST_YOUTUBE_VIDEO_IDS, run full analysis pipeline
  if (!channelId) {
    const idsStr = process.env.TEST_YOUTUBE_VIDEO_IDS;
    if (!idsStr) {
      return NextResponse.json(
        { error: "channelId required, or set TEST_YOUTUBE_VIDEO_IDS in .env (comma-separated)" },
        { status: 400 }
      );
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY required for analysis" },
        { status: 500 }
      );
    }

    const videoIds = idsStr.split(",").map((s) => s.trim()).filter(Boolean);
    if (videoIds.length === 0) {
      return NextResponse.json({ error: "No video IDs in TEST_YOUTUBE_VIDEO_IDS" }, { status: 400 });
    }

    try {
      const videos = await fetchVideosByIds(videoIds);
      const { videos: withTranscripts } = await attachTranscripts({
        videos,
        whisperTopK: 2,
        maxChars: 4000,
      });

      const items = [];
      for (const v of withTranscripts) {
        const analysis = await analyzeVideoItem({
          title: v.title,
          description: v.description ?? "",
          transcript: v.transcript.text,
          stats: v.stats,
        });
        items.push({
          ...v,
          analysis,
        });
      }

      const report = await generateAggregateReport({
        items: items.map((i) => ({
          title: i.title,
          hook: i.analysis.hook,
          theme: i.analysis.theme,
          format: i.analysis.format,
          cta_present: i.analysis.cta_present,
          cta_type: i.analysis.cta_type,
          stats: { views: i.stats.views },
        })),
      });

      return NextResponse.json({ items, report });
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 500 }
      );
    }
  }

  try {
    const videos = await getTopVideosForChannel({
      channelId,
      lookbackDays,
      candidates: 50,
      topN,
    });
    return NextResponse.json({ videos });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 }
    );
  }
}
