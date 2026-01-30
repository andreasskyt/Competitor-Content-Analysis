import { NextResponse } from "next/server";
import { transcribeYouTubeWithWhisper } from "@/lib/transcripts/whisper";

export const runtime = "nodejs";
import { fetchVideosByIds } from "@/lib/youtube/client";
import { analyzeVideoItem } from "@/lib/llm/analyzeItem";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("videoId");

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set. Add it to .env" },
      { status: 500 }
    );
  }

  // Single video: existing behavior
  if (videoId) {
    try {
      const result = await transcribeYouTubeWithWhisper({
        videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
        maxChars: 4000,
      });
      return NextResponse.json(result);
    } catch (e) {
      return NextResponse.json(
        { error: String(e instanceof Error ? e.message : e) },
        { status: 500 }
      );
    }
  }

  // No videoId: use TEST_YOUTUBE_VIDEO_IDS, run full analysis
  const idsStr = process.env.TEST_YOUTUBE_VIDEO_IDS;
  if (!idsStr) {
    return NextResponse.json(
      { error: "videoId required, or set TEST_YOUTUBE_VIDEO_IDS in .env (comma-separated)" },
      { status: 400 }
    );
  }

  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: "YOUTUBE_API_KEY required for batch analysis" },
      { status: 500 }
    );
  }

  const videoIds = idsStr.split(",").map((s) => s.trim()).filter(Boolean);
  if (videoIds.length === 0) {
    return NextResponse.json({ error: "No video IDs in TEST_YOUTUBE_VIDEO_IDS" }, { status: 400 });
  }

  try {
    const videos = await fetchVideosByIds(videoIds);
    const results = [];

    for (const video of videos) {
      const transcript = await transcribeYouTubeWithWhisper({
        videoUrl: video.url,
        maxChars: 4000,
      });
      const analysis = await analyzeVideoItem({
        title: video.title,
        description: video.description ?? "",
        transcript: transcript.text,
        stats: video.stats,
      });
      results.push({
        videoId: video.videoId,
        title: video.title,
        transcript,
        analysis,
      });
    }

    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 }
    );
  }
}
