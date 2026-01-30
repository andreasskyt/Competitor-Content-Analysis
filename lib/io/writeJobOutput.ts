import fs from "fs";
import path from "path";

const JOBS_DIR = path.join(process.cwd(), "public", "jobs");

/** Normalized output schema - same structure for success and partial failures */
export type JobOutput = {
  job: {
    id: string;
    createdAt: string;
    inputs: unknown;
    status: "done" | "failed";
    error?: string;
    meta: {
      runtime_ms: number;
      whisper_used: number;
      videos_skipped_due_to_budget: number;
      videos_skipped_due_to_duration: number;
      transcript_cache_hits?: number;
      analysis_cache_hits?: number;
    };
  };
  summary: {
    videos_analyzed: number;
    transcripts_used: number;
    whisper_used: number;
  };
  sources: { channels: unknown[] };
  items: unknown[];
  report: unknown;
};

/**
 * Writes job output JSON to /public/jobs/<jobId>.json safely.
 * Creates directory if needed.
 */
export async function writeJobOutput(
  jobId: string,
  output: JobOutput | Record<string, unknown>
): Promise<string> {
  const dir = path.join(JOBS_DIR);
  await fs.promises.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${jobId}.json`);
  const content = JSON.stringify(output, null, 2);
  await fs.promises.writeFile(filePath, content, "utf-8");

  return `/jobs/${jobId}.json`;
}
