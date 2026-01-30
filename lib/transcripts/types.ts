export type TranscriptResult = {
  provider: "whisper" | "captions" | "none";
  text: string | null;
  truncated: boolean;
  error?: string;
  /** Reason when provider is "none" or transcript unavailable */
  reason?: "budget_exceeded" | "whisper_error" | "no_captions" | "unavailable" | "skipped_long_video";
};
