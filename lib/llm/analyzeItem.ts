/**
 * Per-video mini analysis - JSON only, cost-optimized.
 * Hooks are always grounded in transcript or title/description.
 */

const HOOK_MAX_CHARS = 160;

function firstSentence(text: string, maxLen: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^[^.!?\n]+/);
  const first = match ? match[0].trim() : trimmed;
  return first.length > maxLen ? first.slice(0, maxLen) : first;
}

function extractGroundedHook(
  transcript: string | null,
  title: string,
  description: string
): string {
  if (transcript && transcript.trim()) {
    const hook = firstSentence(transcript, HOOK_MAX_CHARS);
    if (hook && transcript.includes(hook)) return hook;
    return transcript.trim().slice(0, HOOK_MAX_CHARS);
  }
  if (title && title.trim()) return title.trim().slice(0, HOOK_MAX_CHARS);
  return firstSentence(description, HOOK_MAX_CHARS);
}

function validateHook(transcript: string | null, hook: string, title: string): string {
  if (!hook) return title?.trim().slice(0, HOOK_MAX_CHARS) || "";
  if (transcript && !transcript.includes(hook)) {
    return firstSentence(transcript, HOOK_MAX_CHARS) || title?.trim().slice(0, HOOK_MAX_CHARS) || "";
  }
  return hook;
}

export interface VideoAnalysis {
  hook: string;
  power_words: string[];
  theme: string;
  format: string;
  cta_present: boolean;
  cta_type: "comment" | "follow" | "subscribe" | "download" | "course" | "newsletter" | "other" | null;
  why_it_worked_short: string;
  /** Present when defaults returned due to failure */
  reason?: "no_api_key" | "llm_error" | "parse_failed";
}

const SYSTEM_PROMPT = `Return valid JSON only. No markdown.
Schema: { "power_words": string[], "theme": string, "format": string, "cta_present": boolean, "cta_type": "comment"|"follow"|"subscribe"|"download"|"course"|"newsletter"|"other"|null, "why_it_worked_short": string }
- power_words: extract 1-3 impactful words FROM the given hook only
- format: tutorial, breakdown, story, case study, list, rant, explainer
- why_it_worked_short: ONE sentence, max ~20 words
- cta_type: only if cta_present true, else null`;

function parseJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

interface LlmAnalysisResult {
  power_words: string[];
  theme: string;
  format: string;
  cta_present: boolean;
  cta_type: "comment" | "follow" | "subscribe" | "download" | "course" | "newsletter" | "other" | null;
  why_it_worked_short: string;
}

const DEFAULT_ANALYSIS: VideoAnalysis = {
  hook: "",
  power_words: [],
  theme: "",
  format: "",
  cta_present: false,
  cta_type: null,
  why_it_worked_short: "",
};

export async function analyzeVideoItem(params: {
  title: string;
  description: string;
  transcript: string | null;
  stats: { views: number; likes?: number; comments?: number };
}): Promise<VideoAnalysis> {
  const { title, description, transcript, stats } = params;
  const groundedHook = extractGroundedHook(transcript, title, description);

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return {
      ...DEFAULT_ANALYSIS,
      hook: groundedHook,
      why_it_worked_short: "API key not configured",
      reason: "no_api_key",
    };
  }

  const contentSource = transcript
    ? transcript.slice(0, 3000)
    : `Title: ${title}\nDescription: ${description.slice(0, 1500)}`;
  const userContent = `Hook (verbatim from content - use for power_words only): "${groundedHook}"

Content:
${contentSource}

Stats: views=${stats.views}, likes=${stats.likes ?? "?"}, comments=${stats.comments ?? "?"}

Extract power_words from the hook. Analyze theme, format, cta, why_it_worked_short.`;

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_object" as const },
    max_tokens: 300,
  };

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return {
        ...DEFAULT_ANALYSIS,
        hook: groundedHook,
        why_it_worked_short: `API error: ${res.status}`,
        reason: "llm_error",
      };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";

    let result = parseJson<LlmAnalysisResult & { hook?: string }>(content);
    if (!result) {
      const retryRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          ...body,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
            { role: "user", content: "Fix and return valid JSON only." },
          ],
        }),
      });
      const retryData = (await retryRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      result = parseJson<LlmAnalysisResult & { hook?: string }>(
        retryData.choices?.[0]?.message?.content ?? ""
      );
    }

    if (!result) {
      return {
        ...DEFAULT_ANALYSIS,
        hook: groundedHook,
        why_it_worked_short: "Parse failed",
        reason: "parse_failed",
      };
    }

    if (!Array.isArray(result.power_words)) result.power_words = [];

    let finalHook = groundedHook;
    if (result.hook) {
      finalHook = validateHook(transcript, result.hook, title);
    }

    return {
      hook: finalHook,
      power_words: result.power_words,
      theme: result.theme ?? "",
      format: result.format ?? "",
      cta_present: Boolean(result.cta_present),
      cta_type: result.cta_type ?? null,
      why_it_worked_short: result.why_it_worked_short ?? "",
    };
  } catch (e) {
    return {
      ...DEFAULT_ANALYSIS,
      hook: groundedHook,
      why_it_worked_short: e instanceof Error ? e.message.slice(0, 50) : "Unknown error",
      reason: "llm_error",
    };
  }
}

/** @deprecated Use analyzeVideoItem */
export async function analyzeVideo(
  title: string,
  transcript: string,
  stats: { views: number; likes: number; comments: number }
): Promise<VideoAnalysis> {
  return analyzeVideoItem({
    title,
    description: "",
    transcript: transcript || null,
    stats,
  });
}
