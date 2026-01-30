import { NextResponse } from "next/server";
import { resolveChannelInput, extractHandleFromUrl } from "@/lib/youtube/normalize";
import { getChannelByHandle } from "@/lib/youtube/client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const input = searchParams.get("input");
  const debug = searchParams.get("debug") === "1";

  if (!input) {
    return NextResponse.json(
      { error: "input query param is required" },
      { status: 400 }
    );
  }

  const trimmed = input.trim();
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (debug) {
    const handle = extractHandleFromUrl(trimmed);
    if (handle) {
      try {
        const result = await getChannelByHandle(handle, { debug: true });
        if (result && "debug" in result) {
          return NextResponse.json({
            resolved: result.channel,
            debug: result.debug,
          });
        }
      } catch (e) {
        return NextResponse.json(
          { error: String(e instanceof Error ? e.message : e), debug: null },
          { status: 500 }
        );
      }
    }
  }

  try {
    const resolved = await resolveChannelInput(trimmed, apiKey ?? undefined);
    if (resolved) {
      return NextResponse.json(resolved);
    }
    return NextResponse.json(
      { error: "Could not resolve channel", input: trimmed },
      { status: 404 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: String(e instanceof Error ? e.message : e) },
      { status: 500 }
    );
  }
}
