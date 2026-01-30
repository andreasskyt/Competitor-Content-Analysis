import { NextResponse } from "next/server";
import { createJob } from "@/lib/jobs/store";
import { runJob } from "@/lib/jobs/runner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const channels = Array.isArray(body.channels)
      ? body.channels.filter((c: unknown) => typeof c === "string")
      : [];
    const topN = Math.min(Math.max(Number(body.topN) || 5, 1), 20);
    const lookbackDays = Math.min(Math.max(Number(body.lookbackDays) || 90, 1), 365);
    const whisperFallback = Boolean(body.whisperFallback ?? true);
    const whisperTopK = Math.min(Math.max(Number(body.whisperTopK) || 5, 0), 20);

    if (channels.length === 0) {
      return NextResponse.json(
        { error: "At least one channel is required" },
        { status: 400 }
      );
    }
    if (channels.length > 5) {
      return NextResponse.json(
        { error: "Maximum 5 channels allowed" },
        { status: 400 }
      );
    }

    const job = createJob({
      channels,
      topN,
      lookbackDays,
      whisperFallback,
      whisperTopK,
    });

    runJob(job.id).catch((err) => {
      const { updateJob } = require("@/lib/jobs/store");
      updateJob(job.id, {
        status: "failed",
        error: String(err?.message ?? err),
      });
    });

    return NextResponse.json({ jobId: job.id });
  } catch (e) {
    return NextResponse.json(
      { error: String(e) },
      { status: 500 }
    );
  }
}
