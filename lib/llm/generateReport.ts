/**
 * Aggregate report - single LLM call, JSON only.
 */

export interface AggregateReportInput {
  title: string;
  hook: string;
  theme: string;
  format: string;
  cta_present: boolean;
  cta_type: string | null;
  stats: { views: number };
}

export interface AggregateReport {
  top_videos: Array<{ rank: number; hook: string; title: string; views: number }>;
  winning_patterns: string[];
  top_hooks: string[];
  content_formats: Array<{ format: string; why_it_works: string }>;
  cta_patterns: string[];
  content_ideas: string[];
  key_takeaway: string;
  /** Present when defaults returned due to failure */
  reason?: "no_api_key" | "llm_error" | "parse_failed" | "empty_input" | "channel_resolve_failed" | "no_videos_found";
}

const SYSTEM_PROMPT = `Return valid JSON only. No markdown.
Schema:
{
  "top_videos": [{"rank":1,"hook":"...","title":"...","views":0}],
  "winning_patterns": ["pattern1","pattern2","pattern3"],
  "top_hooks": ["hook1",...],
  "content_formats": [{"format":"...","why_it_works":"..."}],
  "cta_patterns": ["cta1","cta2"],
  "content_ideas": ["idea1",...,"idea20"],
  "key_takeaway": "string"
}
- top_videos: ranked by views desc, top 10
- winning_patterns: concrete, replicable patterns
- content_ideas: 20 actionable titles/hooks, not generic advice
- key_takeaway: 1-2 sentence summary`;

function parseJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

const DEFAULT_REPORT: AggregateReport = {
  top_videos: [],
  winning_patterns: [],
  top_hooks: [],
  content_formats: [],
  cta_patterns: [],
  content_ideas: [],
  key_takeaway: "",
};

export async function generateAggregateReport(params: {
  items: AggregateReportInput[];
}): Promise<AggregateReport> {
  const { items } = params;
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return { ...DEFAULT_REPORT, key_takeaway: "API key not configured", reason: "no_api_key" };
  }

  if (items.length === 0) {
    return { ...DEFAULT_REPORT, reason: "empty_input" };
  }

  const summary = items
    .slice(0, 30)
    .map(
      (i) =>
        `[${i.stats.views} views] ${i.title}\n  hook: ${i.hook}\n  format: ${i.format}\n  theme: ${i.theme}\n  cta: ${i.cta_type ?? "none"}`
    )
    .join("\n\n");

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Analyze and produce report JSON:\n\n${summary}` },
    ],
    response_format: { type: "json_object" as const },
    max_tokens: 1800,
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
      return { ...DEFAULT_REPORT, key_takeaway: `API error: ${res.status}`, reason: "llm_error" };
    }

    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";

    let result = parseJson<AggregateReport>(content);
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
            { role: "user", content: `Analyze and produce report JSON:\n\n${summary}` },
            { role: "user", content: "Fix and return valid JSON only." },
          ],
        }),
      });
      const retryData = (await retryRes.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      result = parseJson<AggregateReport>(retryData.choices?.[0]?.message?.content ?? "");
    }

    if (!result) return { ...DEFAULT_REPORT, key_takeaway: "Parse failed", reason: "parse_failed" };

    // Always use deterministic ordering: views desc (items assumed pre-sorted by caller)
    const topItems = items.slice(0, 10);
    result.top_videos = topItems.map((i, idx) => ({
      rank: idx + 1,
      hook: i.hook,
      title: i.title,
      views: i.stats.views,
    }));

    if (!Array.isArray(result.content_ideas)) result.content_ideas = [];
    if (!Array.isArray(result.winning_patterns)) result.winning_patterns = [];
    if (!Array.isArray(result.cta_patterns)) result.cta_patterns = [];
    if (!Array.isArray(result.content_formats)) result.content_formats = [];
    if (!Array.isArray(result.top_hooks)) result.top_hooks = [];

    return result;
  } catch (e) {
    return {
      ...DEFAULT_REPORT,
      key_takeaway: e instanceof Error ? e.message.slice(0, 80) : "Unknown error",
      reason: "llm_error",
    };
  }
}

